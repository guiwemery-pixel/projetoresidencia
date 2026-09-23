import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

function loadEnvFile() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

export default function setup() {
  loadEnvFile();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Defina TEST_DATABASE_URL (veja backend/.env.example)');
  // Aplica as migrations pendentes no banco de teste (não apaga nada;
  // cada teste limpa as próprias tabelas em tests/helpers.ts)
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
