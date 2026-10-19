import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // Os testes de integração usam o mesmo Postgres; cada um cria o próprio espaço e limpa depois.
    fileParallelism: false,
  },
});
