// Aplica as migrations do Prisma usando a conexão direta do banco, se houver.
// Mostra mensagens claras quando o banco não está configurado e tenta de novo
// quando a falha é passageira (banco na nuvem acordando, conexão caiu, trava
// ocupada por outro deploy rodando ao mesmo tempo).
import { spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { databaseEnvNames, isLocalUrl, resolveDirectDatabaseUrl, withConnectTimeout } from '../backend/dist/config/database-url.js';

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

// P1001: não alcançou o banco · P1002: trava ocupada · P1017: o servidor fechou a conexão
const TRANSIENT = /P1001|P1002|P1017|Can't reach database server|Timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED/i;
const WAIT_SECONDS = [5, 15];

console.log(`Aplicando migrations (usando ${db.name})…`);
let result;
for (let attempt = 0; ; attempt++) {
  result = spawnSync('npx', ['prisma', 'migrate', 'deploy', '--schema', 'backend/prisma/schema.prisma'], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: withConnectTimeout(db.value) },
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (result.status === 0 || attempt >= WAIT_SECONDS.length || !TRANSIENT.test(output)) break;
  console.log(`\n⏳ Falha passageira no banco. Tentando de novo em ${WAIT_SECONDS[attempt]} s…\n`);
  await sleep(WAIT_SECONDS[attempt] * 1000);
}
if (result.status !== 0) {
  fail([
    'As migrations falharam (veja a mensagem do Prisma acima).',
    'Confira se o banco Neon está conectado a este projeto e ativo.',
  ]);
}
