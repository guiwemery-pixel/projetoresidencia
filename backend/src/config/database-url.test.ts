import { describe, expect, it } from 'vitest';
import { datasourceUrl } from '../lib/prisma.js';
import { withConnectTimeout } from './database-url.js';

describe('URL do banco', () => {
  it('dá tempo para um banco na nuvem acordar (connect_timeout)', () => {
    const neon = 'postgresql://u:p@ep-cool-1234.sa-east-1.aws.neon.tech/db?sslmode=require';
    expect(new URL(withConnectTimeout(neon)).searchParams.get('connect_timeout')).toBe('15');
    expect(new URL(withConnectTimeout(neon)).searchParams.get('sslmode')).toBe('require');
    // Não mexe em quem já definiu, nem no banco local
    expect(withConnectTimeout(`${neon}&connect_timeout=30`)).toBe(`${neon}&connect_timeout=30`);
    expect(withConnectTimeout('postgresql://u:p@localhost:5432/db')).toBe('postgresql://u:p@localhost:5432/db');
  });

  it('conexão com pooler recebe pgbouncer=true e connect_timeout', () => {
    const url = new URL(datasourceUrl('postgresql://u:p@ep-cool-1234-pooler.sa-east-1.aws.neon.tech/db?sslmode=require')!);
    expect(url.searchParams.get('pgbouncer')).toBe('true');
    expect(url.searchParams.get('connect_timeout')).toBe('15');
  });
});
