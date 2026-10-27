import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { urlDeTeste } from './vitest.banco';

export default defineConfig({
  // As páginas são TSX; o Next compila o JSX sozinho, aqui o Vitest precisa saber como.
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  test: {
    include: ['src/**/*.test.ts', 'worker/**/*.test.ts'],
    globalSetup: ['./vitest.global.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // Os testes nunca tocam o banco de desenvolvimento (ver vitest.banco.ts).
    env: { DATABASE_URL: urlDeTeste() },
    // Os testes de integração compartilham o banco de teste; cada um cria o próprio espaço e limpa depois.
    fileParallelism: false,
  },
});
