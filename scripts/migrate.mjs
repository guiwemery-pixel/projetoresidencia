// Aplica as migrations do Prisma usando a conexão direta do banco, se houver.
// Mostra mensagens claras quando o banco não está configurado.
import { spawnSync } from 'node:child_process';
import { databaseEnvNames, isLocalUrl, resolveDirectDatabaseUrl } from '../backend/dist/config/database-url.js';

const fail = (lines) => {
  console.error('\n❌ ' + lines.join('\n   ') + '\n');
  process.exit(1);
};

const db = resolveDirectDatabaseUrl();
if (!db) {
  fail([
    'BANCO DE DADOS NÃO CONFIGURADO.',
    'No Vercel: aba Storage → Create Database → Neon → conecte a este projeto',
    '(marque Production, Preview e Development) e depois faça Redeploy.',
    `Variáveis de banco encontradas: ${databaseEnvNames().join(', ') || 'nenhuma'}`,
  ]);
}
if (process.env.VERCEL && isLocalUrl(db.value)) {
  fail([
    `A variável ${db.name} aponta para "localhost" (valor de exemplo).`,
    'No Vercel: Settings → Environment Variables → apague essa variável,',
    'conecte o banco Neon em Storage e faça Redeploy.',
  ]);
}

console.log(`Aplicando migrations (usando ${db.name})…`);
const result = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'backend/prisma/schema.prisma'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: db.value },
});
if (result.status !== 0) {
  fail([
    'As migrations falharam (veja a mensagem do Prisma acima).',
    'Confira se o banco Neon está conectado a este projeto e ativo.',
  ]);
}
