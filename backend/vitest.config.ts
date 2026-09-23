import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup-env.ts'],
    // Os testes de integração compartilham o mesmo banco de teste
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
