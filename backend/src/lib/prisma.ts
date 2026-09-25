import { PrismaClient } from '@prisma/client';
import { resolveDatabaseUrl, withConnectTimeout } from '../config/database-url.js';

/**
 * Conexões via pooler (PgBouncer em modo transação — ex.: Neon "-pooler", usado
 * no Vercel) precisam de `pgbouncer=true` para o Prisma não usar prepared
 * statements. Acrescenta o parâmetro automaticamente quando necessário, e dá
 * tempo para um banco na nuvem que estava "dormindo" acordar.
 */
export function datasourceUrl(value = resolveDatabaseUrl()?.value): string | undefined {
  if (!value) return value;
  const raw = withConnectTimeout(value);
  try {
    const url = new URL(raw);
    if (url.hostname.includes('-pooler') && !url.searchParams.has('pgbouncer')) {
      url.searchParams.set('pgbouncer', 'true');
      return url.toString();
    }
  } catch {
    /* URL fora do padrão: usa como está */
  }
  return raw;
}

export const prisma = new PrismaClient({
  datasourceUrl: datasourceUrl(),
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
