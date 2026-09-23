import request from 'supertest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

export const app = createApp();

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
}

/** Cria um usuário e devolve um agente com o cookie de sessão. */
export async function signup(name: string, extra: Record<string, unknown> = {}) {
  const agent = request.agent(app);
  const email = `${name.toLowerCase().replace(/\W/g, '')}@teste.com`;
  const res = await agent.post('/api/auth/register').send({ name, email, password: 'senha-segura-123', ...extra });
  if (res.status !== 201) throw new Error(`signup falhou: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user: res.body.user as { id: string; email: string }, email };
}

export async function firstArea(agent: request.Agent, name = 'Cirurgia') {
  const res = await agent.get('/api/areas');
  const area = res.body.find((a: { name: string }) => a.name === name);
  if (!area) throw new Error(`área ${name} não encontrada`);
  return area as { id: string; children: { id: string; name: string }[] };
}
