import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');
const escuro = css.slice(css.indexOf('prefers-color-scheme: dark'), css.indexOf('@theme'));
const claro = css.slice(0, css.indexOf('prefers-color-scheme: dark'));
const tema = css.slice(css.indexOf('@theme'));

function cor(bloco: string, nome: string): string {
  const m = bloco.match(new RegExp(`${nome}: *(#[0-9a-fA-F]{3,6})`));
  if (!m) throw new Error(`token ${nome} não encontrado`);
  const h = m[1].slice(1);
  return h.length === 3 ? [...h].map((c) => c + c).join('') : h;
}

function luz(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function razao(a: string, b: string): number {
  const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe('contraste do texto (WCAG AA, 4,5:1)', () => {
  it('link no tema claro, sobre o fundo e sobre o cartão', () => {
    expect(razao(cor(claro, '--link'), cor(claro, '--background'))).toBeGreaterThanOrEqual(4.5);
    expect(razao(cor(claro, '--link'), cor(claro, '--surface'))).toBeGreaterThanOrEqual(4.5);
  });

  it('link no tema escuro', () => {
    expect(razao(cor(escuro, '--link'), cor(escuro, '--surface'))).toBeGreaterThanOrEqual(4.5);
  });

  it('cinza secundário (zinc-500) nos dois temas, sobre o cartão e o fundo', () => {
    expect(razao(cor(tema, '--color-zinc-500'), cor(claro, '--surface'))).toBeGreaterThanOrEqual(4.5);
    expect(razao(cor(tema, '--color-zinc-500'), cor(claro, '--background'))).toBeGreaterThanOrEqual(4.5);
    expect(razao(cor(escuro, '--color-zinc-500'), cor(escuro, '--surface'))).toBeGreaterThanOrEqual(4.5);
    expect(razao(cor(escuro, '--color-zinc-500'), cor(escuro, '--background'))).toBeGreaterThanOrEqual(4.5);
  });

  it('texto branco sobre o fundo do selo de contagem do menu', () => {
    const selo = css.match(/\.nav-badge\s*\{[^}]*background:\s*(#[0-9a-fA-F]{6})/);
    expect(selo).not.toBeNull();
    expect(razao('ffffff', selo![1].slice(1))).toBeGreaterThanOrEqual(4.5);
  });
});
