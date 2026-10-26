import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config';
import { cabecalhosDeSeguranca, MODO_CSP, politicaDeConteudo } from './cabecalhos';

const valor = (cabecalhos: { key: string; value: string }[], nome: string) => cabecalhos.find((c) => c.key === nome)?.value;

describe('cabeçalhos de segurança', () => {
  const cabecalhos = cabecalhosDeSeguranca({ producao: true });

  it('trazem o conjunto básico', () => {
    expect(valor(cabecalhos, 'X-Frame-Options')).toBe('DENY');
    expect(valor(cabecalhos, 'X-Content-Type-Options')).toBe('nosniff');
    expect(valor(cabecalhos, 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(valor(cabecalhos, 'Permissions-Policy')).toContain('camera=()');
    expect(valor(cabecalhos, 'Strict-Transport-Security')).toMatch(/^max-age=\d{8,}/);
  });

  it('a política de conteúdo começa em modo de observação e proíbe ser embutida em outro site', () => {
    expect(MODO_CSP).toBe('Content-Security-Policy-Report-Only');
    const csp = valor(cabecalhos, MODO_CSP)!;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain('data:'); // o QR Code do Pix
    expect(csp).toContain('sentry.io');
  });

  it("eval só é liberado no desenvolvimento, nunca em produção", () => {
    expect(politicaDeConteudo({ producao: true })).not.toContain('unsafe-eval');
    expect(politicaDeConteudo({ producao: false })).toContain('unsafe-eval');
  });
});

describe('next.config', () => {
  it('não anuncia a tecnologia e aplica os cabeçalhos em todas as rotas', async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const regras = await nextConfig.headers!();
    expect(regras).toHaveLength(1);
    expect(regras[0].source).toBe('/:path*');
    expect(valor(regras[0].headers, 'X-Frame-Options')).toBe('DENY');
    expect(valor(regras[0].headers, MODO_CSP)).toContain("frame-ancestors 'none'");
  });
});
