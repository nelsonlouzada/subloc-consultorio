import { afterEach, describe, expect, it, vi } from 'vitest';
import robots from './robots';
import sitemap from './sitemap';

afterEach(() => vi.unstubAllEnvs());

describe('robots.txt', () => {
  it('por padrão manda os buscadores ficarem de fora de tudo', () => {
    vi.stubEnv('SITE_INDEXAVEL', '');
    expect(robots().rules).toEqual({ userAgent: '*', disallow: '/' });
    expect(robots().sitemap).toBeUndefined();
  });

  it('com SITE_INDEXAVEL=true libera só a página pública e aponta o sitemap', () => {
    vi.stubEnv('SITE_INDEXAVEL', 'true');
    vi.stubEnv('SITE_URL', 'https://sala.example.com/');
    const r = robots();
    const regra = r.rules as { allow: string; disallow: string[] };
    expect(regra.allow).toBe('/$');
    for (const area of ['/api/', '/login', '/cadastro', '/inicio', '/agenda', '/financeiro', '/configuracoes', '/reservar', '/minhas-reservas', '/carteira', '/profissionais']) {
      expect(regra.disallow).toContain(area);
    }
    expect(r.sitemap).toBe('https://sala.example.com/sitemap.xml');
  });
});

describe('sitemap.xml', () => {
  it('fica vazio enquanto o site não é indexável ou sem endereço configurado', () => {
    vi.stubEnv('SITE_INDEXAVEL', '');
    vi.stubEnv('SITE_URL', 'https://sala.example.com');
    expect(sitemap()).toEqual([]);
    vi.stubEnv('SITE_INDEXAVEL', 'true');
    vi.stubEnv('SITE_URL', '');
    vi.stubEnv('BETTER_AUTH_URL', '');
    expect(sitemap()).toEqual([]);
  });

  it('lista só a página pública quando indexável', () => {
    vi.stubEnv('SITE_INDEXAVEL', 'true');
    vi.stubEnv('SITE_URL', 'https://sala.example.com');
    expect(sitemap()).toEqual([{ url: 'https://sala.example.com/', changeFrequency: 'monthly', priority: 1 }]);
  });
});
