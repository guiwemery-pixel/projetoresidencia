import { randomBytes } from 'node:crypto';
import { isAdmin } from '../admin/admin.service.js';
import { HttpError, forbidden, notFound } from '../../lib/errors.js';
import { blobStore, eachLimit, type BlobStore } from './media.js';

// Cards da plataforma: baralhos oferecidos a todos os usuários na aba "Cards da
// plataforma" do app de flashcards (ver docs/FLASHCARDS.md). O conteúdo fica só
// no Cloudflare R2, nunca no banco:
//
//   platform/catalog.json                              pacotes publicados
//   platform/packages/<pacote>/<versão>/decks.json     árvore de baralhos do pacote
//   platform/packages/<pacote>/<versão>/cards/<b>.json cards de cada baralho
//   platform/packages/<pacote>/upload.json             publicação em andamento
//
// Todos só leem. O que cada usuário muda (editar, ocultar, adicionar à coleção)
// fica na conta dele, dentro do app de flashcards — nunca no baralho de todos.
// Publica quem administra o site (PLATFORM_ADMIN_EMAILS ou a página Administração): o
// navegador lê o .apkg e envia os baralhos em partes para uma versão nova; o catálogo
// só aponta para ela no fim.

const ROOT = 'platform/';
const CATALOG = `${ROOT}catalog.json`;
const pkgPrefix = (pkg: string) => `${ROOT}packages/${pkg}/`;
const versionPrefix = (pkg: string, version: string) => `${pkgPrefix(pkg)}${version}/`;
const uploadKey = (pkg: string) => `${pkgPrefix(pkg)}upload.json`;
const decksKey = (pkg: string, version: string) => `${versionPrefix(pkg, version)}decks.json`;
const cardsKey = (pkg: string, version: string, deck: string) => `${versionPrefix(pkg, version)}cards/${deck}.json`;

export interface PlatformDeck {
  id: string;
  /** Nome completo, com "::" entre os níveis (como no Anki). */
  name: string;
  parent: string | null;
  /** Cards direto neste baralho (arquivo próprio no R2 quando > 0). */
  own: number;
  /** Cards neste baralho e nos de dentro. */
  total: number;
}

export interface PlatformCard {
  id: string;
  front: string;
  back: string;
  tags: string[];
}

export interface PlatformPackage {
  id: string;
  name: string;
  version: string;
  publishedAt: string;
  cards: number;
  decks: number;
}

interface Catalog {
  packages: PlatformPackage[];
}

const newId = (bytes: number) => randomBytes(bytes).toString('hex');

/** Administradores do site (PLATFORM_ADMIN_EMAILS e os cadastrados em Administração). */
export const isPlatformAdmin = (email: string) => isAdmin(email);

function requireStore(): BlobStore {
  const store = blobStore();
  if (!store) throw new HttpError(503, 'Os cards da plataforma ficam no Cloudflare R2, que ainda não foi configurado no servidor (variáveis R2_*).');
  return store;
}

async function requireAdmin(email: string) {
  if (!(await isAdmin(email))) throw forbidden('Só os administradores do site podem publicar baralhos.');
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

async function readJson<T>(store: BlobStore, key: string): Promise<T | null> {
  const bytes = await store.get(key);
  return bytes ? (JSON.parse(decoder.decode(bytes)) as T) : null;
}

const writeJson = (store: BlobStore, key: string, value: unknown) => store.put(key, encoder.encode(JSON.stringify(value)));

// O catálogo muda raramente: cada instância guarda por alguns segundos. A árvore de
// uma versão nunca muda (versão nova = pasta nova), então fica guardada de vez.
const CATALOG_TTL_MS = 15_000;
let catalogCache: { at: number; value: Catalog } | null = null;
const decksCache = new Map<string, PlatformDeck[]>();

async function catalog(store: BlobStore, fresh = false): Promise<Catalog> {
  if (!fresh && catalogCache && Date.now() - catalogCache.at < CATALOG_TTL_MS) return catalogCache.value;
  const value = (await readJson<Catalog>(store, CATALOG)) ?? { packages: [] };
  catalogCache = { at: Date.now(), value };
  return value;
}

async function saveCatalog(store: BlobStore, value: Catalog) {
  await writeJson(store, CATALOG, value);
  catalogCache = { at: Date.now(), value };
}

async function packageDecks(store: BlobStore, pkg: PlatformPackage) {
  const key = `${pkg.id}/${pkg.version}`;
  const cached = decksCache.get(key);
  if (cached) return cached;
  const decks = (await readJson<PlatformDeck[]>(store, decksKey(pkg.id, pkg.version))) ?? [];
  if (decksCache.size > 20) decksCache.clear();
  decksCache.set(key, decks);
  return decks;
}

/** Esquece o que está guardado em memória (testes). */
export function resetPlatformCache() {
  catalogCache = null;
  decksCache.clear();
}

/** Pacotes publicados com a árvore de baralhos de cada um. */
export async function listPlatform(email: string) {
  const admin = await isAdmin(email);
  const store = blobStore();
  if (!store) return { enabled: false, admin, packages: [] };
  const { packages } = await catalog(store);
  const withDecks = await Promise.all(packages.map(async (p) => ({ ...p, deckList: await packageDecks(store, p) })));
  return { enabled: true, admin, packages: withDecks.map(({ deckList, ...p }) => ({ ...p, decks: deckList })) };
}

/** Arquivo JSON com os cards de um baralho (os bytes como estão no R2). */
export async function readDeckCards(pkg: string, version: string, deck: string) {
  const store = requireStore();
  const bytes = await store.get(cardsKey(pkg, version, deck));
  if (!bytes) throw notFound('Baralho não encontrado. A plataforma pode ter sido atualizada: recarregue a página.');
  return bytes;
}

// ── Publicação (administradores) ────────────────────────────────────────────

/**
 * Começa a publicar um pacote: novo (sem `packageId`) ou uma versão nova de um que
 * já existe. Uma publicação anterior que ficou pela metade é descartada.
 */
export async function startPublish(email: string, packageId?: string) {
  await requireAdmin(email);
  const store = requireStore();
  const current = (await catalog(store, true)).packages;
  if (packageId && !current.some((p) => p.id === packageId)) throw notFound('Pacote não encontrado.');
  const pkg = packageId ?? newId(4);
  const unfinished = await readJson<{ version: string }>(store, uploadKey(pkg));
  const published = current.find((p) => p.id === pkg)?.version;
  if (unfinished && unfinished.version !== published) await store.removePrefix(versionPrefix(pkg, unfinished.version));
  const version = `${Date.now().toString(36)}${newId(3)}`;
  await writeJson(store, uploadKey(pkg), { version, startedAt: new Date().toISOString() });
  return { packageId: pkg, version };
}

async function requireUpload(store: BlobStore, pkg: string, version: string) {
  const upload = await readJson<{ version: string }>(store, uploadKey(pkg));
  if (!upload || upload.version !== version) throw new HttpError(409, 'Esta publicação não está mais em andamento. Comece de novo.');
}

/** Uma parte da publicação: os cards de alguns baralhos. */
export async function uploadDecks(email: string, pkg: string, version: string, decks: { id: string; cards: PlatformCard[] }[]) {
  await requireAdmin(email);
  const store = requireStore();
  await requireUpload(store, pkg, version);
  await eachLimit(decks, 6, (d) => writeJson(store, cardsKey(pkg, version, d.id), d.cards));
  return { saved: decks.length, cards: decks.reduce((s, d) => s + d.cards.length, 0) };
}

/**
 * Fim da publicação: confere se chegaram os cards de todos os baralhos, grava a
 * árvore e aponta o catálogo para a versão nova. A versão anterior é apagada.
 */
export async function finishPublish(email: string, pkg: string, version: string, name: string, decks: PlatformDeck[]) {
  await requireAdmin(email);
  const store = requireStore();
  await requireUpload(store, pkg, version);
  const ids = new Set(decks.map((d) => d.id));
  if (ids.size !== decks.length) throw new HttpError(400, 'Baralhos repetidos na publicação.');
  for (const d of decks) if (d.parent && !ids.has(d.parent)) throw new HttpError(400, `Baralho "${d.name}" aponta para um baralho que não foi enviado.`);
  const uploaded = new Set((await store.list(`${versionPrefix(pkg, version)}cards/`)).map((k) => k.slice(k.lastIndexOf('/') + 1).replace(/\.json$/, '')));
  const missing = decks.filter((d) => d.own > 0 && !uploaded.has(d.id));
  if (missing.length) throw new HttpError(409, `Faltam os cards de ${missing.length} baralho(s) (ex.: ${missing[0].name}). Envie de novo.`);
  const cards = decks.reduce((s, d) => s + d.own, 0);

  await writeJson(store, decksKey(pkg, version), decks);
  const cat = await catalog(store, true);
  const previous = cat.packages.find((p) => p.id === pkg);
  const entry: PlatformPackage = { id: pkg, name, version, publishedAt: new Date().toISOString(), cards, decks: decks.length };
  await saveCatalog(store, { packages: previous ? cat.packages.map((p) => (p.id === pkg ? entry : p)) : cat.packages.concat(entry) });
  await store.remove([uploadKey(pkg)]);
  if (previous && previous.version !== version) {
    await store.removePrefix(versionPrefix(pkg, previous.version)).catch((err) => console.error('R2: falha ao apagar a versão anterior do pacote', pkg, err));
  }
  return entry;
}

/** Tira um pacote da plataforma (os cards que os usuários já adicionaram continuam com eles). */
export async function removePackage(email: string, pkg: string) {
  await requireAdmin(email);
  const store = requireStore();
  const cat = await catalog(store, true);
  if (!cat.packages.some((p) => p.id === pkg)) throw notFound('Pacote não encontrado.');
  await saveCatalog(store, { packages: cat.packages.filter((p) => p.id !== pkg) });
  await store.removePrefix(pkgPrefix(pkg));
}
