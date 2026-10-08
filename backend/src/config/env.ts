import { z } from 'zod';
import { resolveDatabaseUrl } from './database-url.js';

// Variável criada vazia no painel da hospedagem vale como não definida
const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

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
  // Espaço máximo dos flashcards de cada usuário na conta (MB)
  FLASHCARDS_QUOTA_MB: z.coerce.number().positive().default(100),
  // Imagens dos flashcards no Cloudflare R2 (opcional: sem isto elas ficam no banco).
  // Lidas em modules/flashcards/media.ts; declaradas aqui para aparecerem na validação.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  // Outro serviço compatível com S3 (testes, MinIO). Padrão: https://<conta>.r2.cloudflarestorage.com
  R2_ENDPOINT: z.string().optional(),
  // Espaço máximo das imagens de cada usuário no R2 (MB)
  FLASHCARDS_MEDIA_QUOTA_MB: z.coerce.number().positive().default(1024),
  // E-mails (separados por vírgula) que podem publicar os "Cards da plataforma" (ficam no R2).
  // Lida em modules/flashcards/platform.ts.
  PLATFORM_ADMIN_EMAILS: z.string().optional(),
  // E-mails (confirmar cadastro, nova senha, avisos) pelo Resend. Sem a chave, em produção
  // os e-mails ficam desligados; em desenvolvimento aparecem no terminal. Ver modules/mail.
  RESEND_API_KEY: z.preprocess(blank, z.string().optional()),
  // Remetente: "Nome <endereco@dominio-verificado-no-resend>"
  EMAIL_FROM: z.preprocess(blank, z.string().default('Projeto Residente <onboarding@resend.dev>')),
  // Para onde vão as respostas (ex.: e-mail de suporte). Opcional.
  EMAIL_REPLY_TO: z.preprocess(blank, z.string().optional()),
  // Endereço do site usado nos links dos e-mails (ex.: https://projetoresidente.com.br).
  // Sem ele, usa o endereço de onde veio o pedido.
  APP_URL: z.preprocess(blank, z.string().url('APP_URL deve ser um endereço completo, com https://').optional()),
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
