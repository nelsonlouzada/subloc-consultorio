import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool, schema } from '@/db';
import { instanteLocal } from '@/lib/fuso';
import { fabrica } from '@/test/fabrica';

const sessao = vi.fn();
vi.mock('@/lib/sessao', () => ({
  sessaoAtual: () => sessao(),
  contextoRequisicao: async () => ({ ip: '203.0.113.20', userAgent: 'vitest' }),
}));

import { GET } from './route';

const f = fabrica();
afterAll(async () => {
  await f.limpar();
  await pool.end();
});
beforeEach(() => sessao.mockReset());

const pedir = (mes?: string) => GET(new Request(`http://localhost/api/financeiro/carne-leao${mes === undefined ? '' : `?mes=${mes}`}`));

describe('GET /api/financeiro/carne-leao', () => {
  it('exige login e papel de Anfitrião', async () => {
    sessao.mockResolvedValue(null);
    expect((await pedir('2031-11')).status).toBe(401);

    const prof = await f.profissional();
    sessao.mockResolvedValue({ user: { id: prof, papel: 'profissional' } });
    const r = await pedir('2031-11');
    expect(r.status).toBe(403);
    expect(await r.text()).not.toMatch(/CPF|Valor/);
  });

  it.each(['2031-13', 'abc', '', '2031-1', '../../etc'])('recusa o mês %j', async (mes) => {
    sessao.mockResolvedValue({ user: { id: await f.anfitriao(), papel: 'anfitriao' } });
    expect((await pedir(mes)).status).toBe(400);
  });

  it('entrega o CSV como arquivo, sem cache, e registra a exportação na auditoria', async () => {
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    await db.insert(schema.cobranca).values({ profissionalId: prof, finalidade: 'reserva', valorBrutoCentavos: 8000, valorCobradoCentavos: 8000, status: 'paga', meio: 'pix', pagoEm: instanteLocal(2031, 11, 12, 10) });
    sessao.mockResolvedValue({ user: { id: anf, papel: 'anfitriao' } });

    const r = await pedir('2031-11');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="recebimentos-2031-11.csv"');
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    const csv = await r.text();
    expect(csv).toContain('80,00');
    expect(csv).toContain('TOTAL;;;;;80,00;');

    const [ev] = await db.select().from(schema.eventoAuditoria).where(eq(schema.eventoAuditoria.usuarioId, anf));
    expect(ev).toMatchObject({ acao: 'relatorio_exportado', entidade: 'financeiro', ip: '203.0.113.20' });
    expect(ev.dados).toEqual({ relatorio: 'carne_leao', mes: '2031-11', linhas: 1 });
  });
});
