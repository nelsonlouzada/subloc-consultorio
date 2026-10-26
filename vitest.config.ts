import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // As páginas são TSX; o Next compila o JSX sozinho, aqui o Vitest precisa saber como.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // Os testes de integração usam o mesmo Postgres; cada um cria o próprio espaço e limpa depois.
    fileParallelism: false,
  },
});
