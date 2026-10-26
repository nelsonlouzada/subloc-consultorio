import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const raiz = __dirname;

function paginas(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return nome === 'api' ? [] : paginas(caminho);
    return nome === 'page.tsx' ? [caminho] : [];
  });
}

const tem = (arquivo: string) => existsSync(arquivo) && /export (const metadata|async function generateMetadata)/.test(readFileSync(arquivo, 'utf8'));

describe('títulos de página', () => {
  it('toda página tem título próprio (na página ou no layout do segmento)', () => {
    const sem = paginas(raiz)
      .filter((p) => dirname(p) !== raiz) // a raiz só redireciona
      .filter((p) => !tem(p) && !tem(join(dirname(p), 'layout.tsx')))
      .map((p) => relative(raiz, p));
    expect(sem).toEqual([]);
  });
});
