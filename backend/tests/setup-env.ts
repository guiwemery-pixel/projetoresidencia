import { existsSync, readFileSync } from 'node:fs';

// Garante que os testes usem SEMPRE o banco de teste (nunca o de desenvolvimento).
if (!process.env.TEST_DATABASE_URL && existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
process.env.NODE_ENV = 'test';
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('Defina TEST_DATABASE_URL (veja backend/.env.example)');
process.env.DATABASE_URL = testUrl;
process.env.NOTIFICATIONS_JOB_MINUTES = '0';
