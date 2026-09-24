import { z } from 'zod';
import { resolveDatabaseUrl } from './database-url.js';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
  NOTIFICATIONS_JOB_MINUTES: z.coerce.number().int().min(0).default(60),
  // Cookie "Secure" (só HTTPS). Padrão: ligado em produção.
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  // Diretório do build do frontend servido em produção (opcional)
  FRONTEND_DIST: z.string().optional(),
  // Segredo do agendador (Vercel Cron envia "Authorization: Bearer <CRON_SECRET>")
  CRON_SECRET: z.string().optional(),
});

// Aceita a URL do banco com outros nomes/prefixos (integrações do Vercel)
const database = resolveDatabaseUrl();
if (database && !process.env.DATABASE_URL) process.env.DATABASE_URL = database.value;

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Lança (em vez de encerrar o processo) para a mensagem aparecer nos logs de funções serverless
  throw new Error(`Variáveis de ambiente inválidas: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
