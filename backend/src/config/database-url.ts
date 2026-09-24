// Descobre a URL do PostgreSQL a partir das variáveis de ambiente.
// Integrações de banco (Neon, Supabase, Vercel Postgres…) usam nomes diferentes
// e às vezes um prefixo (ex.: STORAGE_DATABASE_URL). Aceitamos todos.

type Env = Record<string, string | undefined>;

const POOLED = ['DATABASE_URL', 'POSTGRES_PRISMA_URL', 'POSTGRES_URL'];
const DIRECT = ['DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING', 'DIRECT_URL'];

/** Variáveis de teste (ex.: TEST_DATABASE_URL) nunca são usadas em produção. */
const ignored = (key: string) => key.startsWith('TEST_');

function find(env: Env, names: string[]): { name: string; value: string } | undefined {
  for (const name of names) {
    const value = env[name];
    if (value) return { name, value };
  }
  // Mesmo nome com prefixo (ex.: STORAGE_DATABASE_URL)
  for (const name of names) {
    const key = Object.keys(env).find((k) => k.endsWith(`_${name}`) && !ignored(k) && env[k]);
    if (key) return { name: key, value: env[key]! };
  }
  return undefined;
}

/** URL usada pela aplicação (preferência: conexão com pooler). */
export function resolveDatabaseUrl(env: Env = process.env) {
  return find(env, POOLED) ?? find(env, DIRECT);
}

/** URL usada pelas migrations (preferência: conexão direta, sem pooler). */
export function resolveDirectDatabaseUrl(env: Env = process.env) {
  return find(env, DIRECT) ?? find(env, POOLED);
}

/** Nomes (nunca valores) das variáveis de banco encontradas — para diagnóstico. */
export function databaseEnvNames(env: Env = process.env) {
  return Object.keys(env).filter((k) => /DATABASE_URL|POSTGRES_(PRISMA_)?URL/.test(k) && env[k]);
}

export const isLocalUrl = (url: string) => /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
