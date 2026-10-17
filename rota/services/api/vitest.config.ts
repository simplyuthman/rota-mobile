import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@rota/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
    },
  },
  test: {
    setupFiles: ['./tests/setup.ts'],
    environment: 'node',
    testTimeout: 20000,
  },
});

