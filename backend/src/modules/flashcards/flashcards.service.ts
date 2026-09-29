import { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/errors.js';
import { prisma, type Tx } from '../../lib/prisma.js';
import { blobStore, eachLimit, mediaKey, parseDataUrl, userPrefix } from './media.js';

// Cópia na conta dos dados do app de flashcards (ver docs/FLASHCARDS.md).
// O servidor não interpreta os registros: guarda o JSON de cada um e numera as
// gravações. Cada aparelho envia o que mudou (push) e baixa o que os outros
// gravaram depois do seu cursor (pull). A última gravação de um registro vence.

export const SYNC_STORES = ['cards', 'nodes', 'decks', 'logs', 'quickSessions', 'sessions', 'sources', 'media', 'drafts', 'kv', 'trash'] as const;
export type SyncStore = (typeof SYNC_STORES)[number];

/** Um registro por gravação: `d` = conteúdo novo, `del` = excluído. */
export interface PushOp {
  s: SyncStore;
  id: string;
  d?: Record<string, unknown>;
  del?: boolean;
}

// Respostas abaixo do limite de corpo das funções serverless (4,5 MB no Vercel)
const PULL_MAX_ROWS = 2000;
const PULL_MAX_BYTES = 2_500_000;
export const RECORD_MAX_BYTES = 3_500_000;
/** Maior imagem aceita (chega como data URL em base64 dentro do lote de ~6 MB). */
export const MEDIA_MAX_BYTES = 3_000_000;
const TOMBSTONE_DAYS = 90;

export const quotaBytes = () => Math.round(env.FLASHCARDS_QUOTA_MB * 1024 * 1024);
export const mediaQuotaBytes = () => Math.round(env.FLASHCARDS_MEDIA_QUOTA_MB * 1024 * 1024);

interface State {
  version: number;
  epoch: number;
  bytes: number;
  mediaBytes: number;
}

/** Uso da conta (vai em todas as respostas da sincronização). */
function usage(s: { bytes: number; mediaBytes: number }) {
  return { bytes: s.bytes, quota: quotaBytes(), mediaStore: blobStore() ? 'r2' : 'db', mediaBytes: s.mediaBytes, mediaQuota: mediaQuotaBytes() };
}

/**
 * Reserva `count` versões e trava o estado do usuário até o fim da transação.
 * Gravações do mesmo usuário ficam em fila, então as versões são confirmadas na
 * ordem em que foram distribuídas — um aparelho nunca pula uma gravação.
 */
async function reserveVersions(tx: Tx, userId: string, count: number): Promise<State> {
  const [row] = await tx.$queryRaw<{ version: bigint; epoch: number; bytes: bigint; media_bytes: bigint }[]>`
    INSERT INTO flashcard_sync (user_id, version, updated_at) VALUES (${userId}, ${count}, now())
    ON CONFLICT (user_id) DO UPDATE SET version = flashcard_sync.version + ${count}, updated_at = now()
    RETURNING version, epoch, bytes, media_bytes`;
  return { version: Number(row.version), epoch: row.epoch, bytes: Number(row.bytes), mediaBytes: Number(row.media_bytes) };
}

async function currentState(userId: string) {
  const s = await prisma.flashcardSync.findUnique({ where: { userId }, select: { version: true, epoch: true, bytes: true, mediaBytes: true, purgedVersion: true } });
  return {
    version: Number(s?.version ?? 0),
    epoch: s?.epoch ?? 1,
    bytes: Number(s?.bytes ?? 0),
    mediaBytes: Number(s?.mediaBytes ?? 0),
    purgedVersion: Number(s?.purgedVersion ?? 0),
  };
}

export async function status(userId: string) {
  const s = await currentState(userId);
  return { version: s.version, epoch: s.epoch, ...usage(s) };
}

const mediaQuotaError = () => new HttpError(413, `As imagens dos flashcards chegaram ao limite de ${env.FLASHCARDS_MEDIA_QUOTA_MB} MB da conta.`, { quota: true });

/** Soma do tamanho atual (no banco e fora dele) dos registros que serão sobrescritos. */
async function oldSizes(db: Tx | typeof prisma, userId: string, stores: string[], ids: string[]) {
  const [old] = await db.$queryRaw<{ total: bigint | null; blobs: bigint | null }[]>`
    SELECT sum(r.size)::bigint AS total, sum(r.blob_size)::bigint AS blobs
    FROM flashcard_records r
    JOIN unnest(${stores}::text[], ${ids}::text[]) AS i(store, id) ON r.store = i.store AND r.id = i.id
    WHERE r.user_id = ${userId}`;
  return { size: Number(old.total ?? 0), blobs: Number(old.blobs ?? 0) };
}

/** A coleção foi substituída depois que o aparelho sincronizou (desfaz a transação). */
class StaleEpoch extends Error {
  constructor(public epoch: number) {
    super('stale epoch');
  }
}

/**
 * Grava as alterações de um aparelho. `epoch` ausente = aparelho que nunca
 * sincronizou. Se a coleção foi substituída em outro aparelho (restaurar backup,
 * apagar tudo), nada é gravado e a resposta pede para recomeçar: `{ reset: true, epoch }`.
 */
export async function push(userId: string, epoch: number | null | undefined, ops: PushOp[]) {
  const byKey = new Map<string, PushOp>();
  for (const op of ops) byKey.set(`${op.s}\u0000${op.id}`, op);
  const list = [...byKey.values()];
  if (!list.length) return status(userId);

  // Com o R2, a imagem vai para o bucket e o registro guarda só nome, tipo e tamanho
  const store = blobStore();
  const uploads: { key: string; bytes: Uint8Array }[] = [];
  const removed: string[] = [];
  const stores: string[] = [];
  const ids: string[] = [];
  const datas: (string | null)[] = [];
  const sizes: number[] = [];
  const blobSizes: number[] = [];
  for (const op of list) {
    let d = op.d;
    let blobSize = 0;
    if (store && op.s === 'media') {
      if (op.del) removed.push(mediaKey(userId, op.id));
      else if (d && typeof d.dataUrl === 'string') {
        const file = parseDataUrl(d.dataUrl);
        if (file.bytes.length > MEDIA_MAX_BYTES) throw new HttpError(413, `Imagem grande demais (${op.id}).`);
        uploads.push({ key: mediaKey(userId, op.id), bytes: file.bytes });
        d = { name: typeof d.name === 'string' ? d.name : op.id, type: file.type, size: file.bytes.length, stored: 'r2' };
        blobSize = file.bytes.length;
      }
    }
    const data = op.del ? null : JSON.stringify(d ?? {});
    const size = data ? Buffer.byteLength(data) : 0;
    if (size > RECORD_MAX_BYTES) throw new HttpError(413, `Registro grande demais para a conta (${op.s}).`);
    stores.push(op.s);
    ids.push(op.id);
    datas.push(data);
    sizes.push(size);
    blobSizes.push(blobSize);
  }
  const newBlobs = blobSizes.reduce((a, b) => a + b, 0);

  if (uploads.length && store) {
    // Antes de enviar os arquivos: coleção substituída ou cota estourada não sobem nada
    const s = await currentState(userId);
    if (epoch != null && epoch !== s.epoch) return { reset: true as const, epoch: s.epoch };
    const old = await oldSizes(prisma, userId, stores, ids);
    if (newBlobs > old.blobs && s.mediaBytes + newBlobs - old.blobs > mediaQuotaBytes()) throw mediaQuotaError();
    await eachLimit(uploads, 4, (u) => store.put(u.key, u.bytes));
  }

  let result;
  try {
    result = await prisma.$transaction(
      async (tx) => {
        const state = await reserveVersions(tx, userId, list.length);
        if (epoch != null && epoch !== state.epoch) throw new StaleEpoch(state.epoch);
        const old = await oldSizes(tx, userId, stores, ids);
        const delta = sizes.reduce((a, b) => a + b, 0) - old.size;
        const bytes = Math.max(0, state.bytes + delta);
        if (delta > 0 && bytes > quotaBytes()) {
          throw new HttpError(413, `Os flashcards da conta chegaram ao limite de ${env.FLASHCARDS_QUOTA_MB} MB.`, { quota: true });
        }
        const mediaDelta = newBlobs - old.blobs;
        const mediaBytes = Math.max(0, state.mediaBytes + mediaDelta);
        if (mediaDelta > 0 && mediaBytes > mediaQuotaBytes()) throw mediaQuotaError();
        const first = state.version - list.length + 1;
        const versions = list.map((_, i) => first + i);
        await tx.$executeRaw`
          INSERT INTO flashcard_records (user_id, store, id, data, size, blob_size, version, updated_at)
          SELECT ${userId}, i.store, i.id, i.data, i.size, i.blob_size, i.version, now()
          FROM unnest(${stores}::text[], ${ids}::text[], ${datas}::text[], ${sizes}::int[], ${blobSizes}::int[], ${versions}::bigint[])
            AS i(store, id, data, size, blob_size, version)
          ON CONFLICT (user_id, store, id)
          DO UPDATE SET data = EXCLUDED.data, size = EXCLUDED.size, blob_size = EXCLUDED.blob_size, version = EXCLUDED.version, updated_at = now()`;
        await tx.$executeRaw`UPDATE flashcard_sync SET bytes = ${bytes}, media_bytes = ${mediaBytes} WHERE user_id = ${userId}`;
        return { version: state.version, epoch: state.epoch, ...usage({ bytes, mediaBytes }) };
      },
      { timeout: 60_000, maxWait: 20_000 },
    );
  } catch (err) {
    if (err instanceof StaleEpoch) return { reset: true as const, epoch: err.epoch };
    throw err;
  }
  // Imagens excluídas saem do bucket (se falhar, sobra um arquivo sem uso: só avisa no log)
  if (removed.length && store) await store.remove(removed).catch((err) => console.error('R2: falha ao apagar imagens', err));
  return result;
}

export interface PullResult extends ReturnType<typeof usage> {
  reset?: true;
  epoch: number;
  cursor: number;
  more: boolean;
  total?: number;
  records: { s: string; id: string; raw: string | null }[];
}

/**
 * Registros gravados depois de `since`, em ordem de versão, em páginas de até
 * ~2,5 MB. Pede um recomeço (reset) quando o cursor do aparelho não serve mais:
 * coleção substituída (epoch), exclusões antigas já descartadas ou cursor à frente
 * do servidor (banco restaurado).
 */
export async function pull(userId: string, since: number, epoch?: number): Promise<PullResult> {
  const s = await currentState(userId);
  const base = { epoch: s.epoch, ...usage(s) };
  if (since > 0 && ((epoch !== undefined && epoch !== s.epoch) || since < s.purgedVersion || since > s.version)) {
    return { ...base, reset: true, cursor: 0, more: true, records: [] };
  }
  // Primeira carga: exclusões não interessam a quem ainda não tem nada
  const onlyLive = since === 0 ? Prisma.sql`AND data IS NOT NULL` : Prisma.empty;
  const rows = await prisma.$queryRaw<{ store: string; id: string; data: string | null; version: bigint; size: number }[]>`
    SELECT store, id, data, version, size FROM flashcard_records
    WHERE user_id = ${userId} AND version > ${since} ${onlyLive}
    ORDER BY version
    LIMIT ${PULL_MAX_ROWS}`;
  let used = 0;
  let take = 0;
  while (take < rows.length && (take === 0 || used + rows[take].size <= PULL_MAX_BYTES)) used += rows[take++].size;
  const page = rows.slice(0, take);
  let total: number | undefined;
  if (since === 0) {
    const [c] = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM flashcard_records WHERE user_id = ${userId} AND data IS NOT NULL`;
    total = Number(c.n);
  }
  return {
    ...base,
    cursor: page.length ? Number(page[page.length - 1].version) : since,
    more: take < rows.length || rows.length === PULL_MAX_ROWS,
    total,
    records: page.map((r) => ({ s: r.store, id: r.id, raw: r.data })),
  };
}

/** Corpo JSON do pull sem decodificar os registros (já estão em JSON no banco). */
export function pullBody(r: PullResult): string {
  const { records, ...meta } = r;
  const items = records.map((x) => `{"s":${JSON.stringify(x.s)},"id":${JSON.stringify(x.id)},"d":${x.raw ?? 'null'}}`);
  return `${JSON.stringify(meta).slice(0, -1)},"records":[${items.join(',')}]}`;
}

/** Substitui a coleção inteira: apaga tudo e muda o epoch (os outros aparelhos recomeçam). */
export async function resetCollection(userId: string) {
  const result = await prisma.$transaction(
    async (tx) => {
      await reserveVersions(tx, userId, 1);
      await tx.flashcardRecord.deleteMany({ where: { userId } });
      const s = await tx.flashcardSync.update({
        where: { userId },
        data: { epoch: { increment: 1 }, bytes: 0, mediaBytes: 0, summary: Prisma.DbNull, summaryAt: null },
      });
      return { epoch: s.epoch, version: Number(s.version), ...usage({ bytes: 0, mediaBytes: 0 }) };
    },
    { timeout: 120_000, maxWait: 20_000 },
  );
  await removeUserMedia(userId);
  return result;
}

// ── Imagens ──────────────────────────────────────────────────────────────────

/** Bytes de uma imagem do usuário (do R2 ou, se antiga, de dentro do registro). */
export async function readMedia(userId: string, name: string): Promise<Uint8Array | null> {
  const rec = await prisma.flashcardRecord.findUnique({ where: { userId_store_id: { userId, store: 'media', id: name } }, select: { data: true } });
  if (!rec?.data) return null;
  let d: { stored?: unknown; dataUrl?: unknown };
  try {
    d = JSON.parse(rec.data);
  } catch {
    return null;
  }
  if (d.stored === 'r2') return (await blobStore()?.get(mediaKey(userId, name))) ?? null;
  if (typeof d.dataUrl === 'string') return parseDataUrl(d.dataUrl).bytes;
  return null;
}

/** Apaga todas as imagens do usuário no R2 (apagar tudo, restaurar backup, excluir a conta). */
export async function removeUserMedia(userId: string) {
  const store = blobStore();
  if (!store) return 0;
  return store.removePrefix(userPrefix(userId)).catch((err) => {
    console.error('R2: falha ao apagar as imagens do usuário', err);
    return 0;
  });
}

/**
 * Leva para o R2 as imagens que ainda estão dentro do banco (enviadas antes de o
 * R2 ser configurado). O registro passa a guardar só nome, tipo e tamanho, sem mudar
 * de versão: os aparelhos que já têm a imagem ficam como estão, e quem baixar de novo
 * busca o arquivo pela API.
 */
export async function migrateMediaToBlobStore(maxRows = 200) {
  const store = blobStore();
  if (!store) return { migrated: 0, done: true };
  const rows = await prisma.$queryRaw<{ user_id: string; id: string; data: string }[]>`
    SELECT user_id, id, data FROM flashcard_records
    WHERE store = 'media' AND data IS NOT NULL AND blob_size = 0 AND data LIKE '%"dataUrl"%'
    LIMIT ${maxRows}`;
  const users = new Set<string>();
  let migrated = 0;
  await eachLimit(rows, 4, async (r) => {
    try {
      const d = JSON.parse(r.data) as { name?: unknown; dataUrl?: unknown };
      if (typeof d.dataUrl !== 'string') return;
      const file = parseDataUrl(d.dataUrl);
      await store.put(mediaKey(r.user_id, r.id), file.bytes);
      const meta = JSON.stringify({ name: typeof d.name === 'string' ? d.name : r.id, type: file.type, size: file.bytes.length, stored: 'r2' });
      const n = await prisma.$executeRaw`
        UPDATE flashcard_records SET data = ${meta}, size = ${Buffer.byteLength(meta)}, blob_size = ${file.bytes.length}
        WHERE user_id = ${r.user_id} AND store = 'media' AND id = ${r.id} AND data = ${r.data}`;
      if (n) {
        migrated++;
        users.add(r.user_id);
      }
    } catch (err) {
      console.error('R2: falha ao migrar imagem', r.user_id, r.id, err);
    }
  });
  if (users.size) {
    await prisma.$executeRaw`
      UPDATE flashcard_sync s SET
        bytes = (SELECT coalesce(sum(size), 0) FROM flashcard_records r WHERE r.user_id = s.user_id),
        media_bytes = (SELECT coalesce(sum(blob_size), 0) FROM flashcard_records r WHERE r.user_id = s.user_id)
      WHERE s.user_id = ANY(${[...users]}::text[])`;
  }
  return { migrated, done: rows.length < maxRows };
}

// ── Resumo para a página inicial ─────────────────────────────────────────────
// Calculado pelo próprio app (mesmas regras da fila de revisão, limites diários e
// baralhos suspensos) sempre que algo muda, com a previsão dos próximos dias.

export async function saveSummary(userId: string, summary: Record<string, unknown>) {
  const json = JSON.stringify(summary);
  await prisma.$executeRaw`
    INSERT INTO flashcard_sync (user_id, summary, summary_at, updated_at) VALUES (${userId}, ${json}::jsonb, now(), now())
    ON CONFLICT (user_id) DO UPDATE SET summary = EXCLUDED.summary, summary_at = now(), updated_at = now()`;
}

export async function getSummary(userId: string) {
  const s = await prisma.flashcardSync.findUnique({ where: { userId }, select: { summary: true, summaryAt: true } });
  return { summary: (s?.summary as Record<string, unknown> | null) ?? null, updatedAt: s?.summaryAt?.toISOString() ?? null };
}

// ── Busca global ─────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
};

export function htmlToText(html: unknown): string {
  return String(html ?? '')
    .replace(/<(br|\/p|\/div|\/li|hr)[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/g, (_, e: string) => ENTITIES[e])
    .replace(/\s+/g, ' ')
    .trim();
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export async function searchCards(userId: string, rawQuery: string, limit = 8) {
  const q = rawQuery.trim();
  if (q.length < 2) return { total: 0, cards: [] };
  const pattern = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const rows = await prisma.$queryRaw<{ id: string; data: string }[]>`
    SELECT id, data FROM flashcard_records
    WHERE user_id = ${userId} AND store = 'cards' AND data IS NOT NULL AND data ILIKE ${pattern}
    LIMIT 300`;
  const needle = q.toLocaleLowerCase('pt-BR');
  const hits: { id: string; front: string; back: string; deckId: string | null }[] = [];
  for (const r of rows) {
    let c: { front?: unknown; back?: unknown; tags?: unknown; deckId?: unknown };
    try {
      c = JSON.parse(r.data);
    } catch {
      continue;
    }
    const front = htmlToText(c.front);
    const back = htmlToText(c.back);
    const tags = Array.isArray(c.tags) ? c.tags.join(' ') : '';
    if (`${front} ${back} ${tags}`.toLocaleLowerCase('pt-BR').includes(needle)) {
      hits.push({ id: r.id, front: clip(front, 160), back: clip(back, 200), deckId: typeof c.deckId === 'string' ? c.deckId : null });
    }
  }
  const shown = hits.slice(0, limit);
  const deckIds = [...new Set(shown.map((h) => h.deckId).filter((x): x is string => !!x))];
  const decks = deckIds.length
    ? await prisma.flashcardRecord.findMany({ where: { userId, store: 'decks', id: { in: deckIds }, data: { not: null } }, select: { id: true, data: true } })
    : [];
  const deckName = new Map(
    decks.map((d) => {
      try {
        return [d.id, String((JSON.parse(d.data!) as { name?: unknown }).name ?? '')];
      } catch {
        return [d.id, ''];
      }
    }),
  );
  return {
    total: hits.length,
    cards: shown.map(({ deckId, ...h }) => ({ ...h, deck: (deckId && deckName.get(deckId)) || null })),
  };
}

// ── Faxina ───────────────────────────────────────────────────────────────────

/**
 * Descarta marcas de exclusão antigas. Um aparelho cujo cursor ficou para trás
 * delas recebe "recomeçar" no próximo pull (ver `purgedVersion`), então nada
 * excluído volta por engano.
 */
export async function purgeOldTombstones(days = TOMBSTONE_DAYS) {
  return prisma.$executeRaw`
    WITH purged AS (
      DELETE FROM flashcard_records
      WHERE data IS NULL AND updated_at < now() - make_interval(days => ${days}::int)
      RETURNING user_id, version
    )
    UPDATE flashcard_sync s SET purged_version = GREATEST(s.purged_version, p.maxv)
    FROM (SELECT user_id, max(version) AS maxv FROM purged GROUP BY user_id) p
    WHERE s.user_id = p.user_id`;
}
