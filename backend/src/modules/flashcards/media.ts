import { createHash } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import { badRequest } from '../../lib/errors.js';

// Imagens dos flashcards (baralhos do Anki) guardadas fora do banco, no Cloudflare R2
// (API compatível com S3). O navegador envia e recebe as imagens sempre pela API do
// site, que confere o login — o bucket fica privado e não precisa de CORS.
// Sem as variáveis R2_*, as imagens continuam dentro do registro no banco.

export interface BlobStore {
  put(key: string, body: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  remove(keys: string[]): Promise<void>;
  /** Chaves que começam com `prefix`. */
  list(prefix: string): Promise<string[]>;
  /** Apaga tudo o que começa com `prefix`; devolve quantos objetos apagou. */
  removePrefix(prefix: string): Promise<number>;
}

const xmlEscape = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
const xmlUnescape = (s: string) =>
  s.replace(/&(#\d+|lt|gt|amp|quot|apos);/g, (m, e: string) =>
    e[0] === '#' ? String.fromCharCode(Number(e.slice(1))) : ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[e],
  );

class S3Store implements BlobStore {
  private client: AwsClient;

  constructor(
    private endpoint: string,
    private bucket: string,
    accessKeyId: string,
    secretAccessKey: string,
  ) {
    this.client = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
  }

  private url(key: string, query = '') {
    return `${this.endpoint}/${encodeURIComponent(this.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}${query}`;
  }

  private async check(res: Response, what: string) {
    if (res.ok) return;
    const text = await res.text().catch(() => '');
    throw new Error(`R2 ${what} falhou (${res.status}): ${text.slice(0, 200)}`);
  }

  async put(key: string, body: Uint8Array) {
    const res = await this.client.fetch(this.url(key), { method: 'PUT', body, headers: { 'Content-Type': 'application/octet-stream' } });
    await this.check(res, 'PUT');
  }

  async get(key: string) {
    const res = await this.client.fetch(this.url(key));
    if (res.status === 404) return null;
    await this.check(res, 'GET');
    return new Uint8Array(await res.arrayBuffer());
  }

  async remove(keys: string[]) {
    for (let i = 0; i < keys.length; i += 1000) {
      const body = `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${keys
        .slice(i, i + 1000)
        .map((k) => `<Object><Key>${xmlEscape(k)}</Key></Object>`)
        .join('')}</Delete>`;
      const md5 = createHash('md5').update(body).digest('base64');
      const res = await this.client.fetch(`${this.endpoint}/${encodeURIComponent(this.bucket)}?delete`, {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/xml', 'Content-MD5': md5 },
      });
      await this.check(res, 'DELETE');
    }
  }

  /** Uma página da listagem: chaves e o token da próxima (null = acabou). */
  private async listPage(prefix: string, token: string | null) {
    const q = new URLSearchParams({ 'list-type': '2', prefix });
    if (token) q.set('continuation-token', token);
    const res = await this.client.fetch(`${this.endpoint}/${encodeURIComponent(this.bucket)}?${q}`);
    await this.check(res, 'LIST');
    const xml = await res.text();
    const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => xmlUnescape(m[1]));
    const next = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xmlUnescape(xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1] ?? '') : null;
    return { keys, next: next || null };
  }

  async list(prefix: string) {
    const all: string[] = [];
    let token: string | null = null;
    for (let page = 0; page < 1000; page++) {
      const { keys, next } = await this.listPage(prefix, token);
      all.push(...keys);
      token = next;
      if (!token) break;
    }
    return all;
  }

  async removePrefix(prefix: string) {
    let removed = 0;
    let token: string | null = null;
    for (let page = 0; page < 1000; page++) {
      const { keys, next } = await this.listPage(prefix, token);
      if (keys.length) await this.remove(keys);
      removed += keys.length;
      token = next;
      if (!token) break;
    }
    return removed;
  }
}

let cached: BlobStore | null | undefined;

/** O armazenamento de imagens configurado, ou null (imagens ficam no banco). */
export function blobStore(): BlobStore | null {
  if (cached !== undefined) return cached;
  const e = process.env;
  const endpoint = e.R2_ENDPOINT || (e.R2_ACCOUNT_ID ? `https://${e.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : '');
  cached = endpoint && e.R2_BUCKET && e.R2_ACCESS_KEY_ID && e.R2_SECRET_ACCESS_KEY ? new S3Store(endpoint.replace(/\/$/, ''), e.R2_BUCKET, e.R2_ACCESS_KEY_ID, e.R2_SECRET_ACCESS_KEY) : null;
  return cached;
}

/** Relê as variáveis R2_* (testes). */
export function resetBlobStore() {
  cached = undefined;
}

export const userPrefix = (userId: string) => `flashcards/${userId}/`;

/** Chave do arquivo no bucket: por usuário, com o nome da imagem transformado em hash. */
export const mediaKey = (userId: string, name: string) => userPrefix(userId) + createHash('sha256').update(name).digest('hex').slice(0, 40);

const MIME = /^[a-z]+\/[a-z0-9.+-]+$/i;

/** data:<tipo>;base64,<dados> → bytes e tipo. */
export function parseDataUrl(dataUrl: string): { type: string; bytes: Uint8Array } {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw badRequest('Imagem inválida (data URL esperada).');
  const type = MIME.test(m[1]) ? m[1].toLowerCase() : 'application/octet-stream';
  const bytes = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
  return { type, bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
}

/** Executa `fn` em até `limit` itens ao mesmo tempo. */
export async function eachLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
