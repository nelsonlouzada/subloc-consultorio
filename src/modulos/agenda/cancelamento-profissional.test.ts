import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool, schema } from '@/db';

const enviarEmail = vi.fn<(para: string, assunto: string, html: string) => Promise<void>>();
vi.mock('@/lib/email', () => ({ enviarEmail: (...a: [string, string, string]) => enviarEmail(...a) }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

import { instanteLocal } from '@/lib/fuso';
import { concederCredito, saldoDisponivel } from '@/modulos/carteira/carteira';
import { garantirDocumentosIniciais } from '@/modulos/configuracao/documentos-iniciais';
import { fabrica } from '@/test/fabrica';
import { cancelarReservaPeloProfissional, previaCancelamento, ReservaJaIniciadaError } from './cancelamento';
import { marcarPago } from './pagamento';
import { criarReserva } from './reserva';
import { aprovarReserva, EstadoReservaError, ReservaNaoEncontradaError } from './solicitacao';

const f = fabrica();
const ctx = { ip: '203.0.113.5', userAgent: 'vitest' };
const agora = instanteLocal(2026, 10, 20, 12);
const HORA = 3_600_000;
const h = (hora: number, dia = 2, mes = 11) => instanteLocal(2026, mes, dia, hora);

async function pedir(espacoId: string, profissionalId: string, de = 9, ate = 10, dia = 2) {
  const r = await criarReserva({ espacoId, profissionalId, inicio: h(de, dia), fim: h(ate, dia), unidade: 'hora' }, ctx, agora);
  if (!r.ok) throw new Error(`pedido recusado: ${r.erro}`);
  return r.reservaId;
}
async function confirmada(espacoId: string, prof: string, anf: string, de = 9, ate = 10, dia = 2) {
  const id = await pedir(espacoId, prof, de, ate, dia);
  await aprovarReserva(id, anf, {}, agora);
  await marcarPago(id, anf, {}, agora);
  return id;
}
const reserva = async (id: string) => (await db.select().from(schema.reserva).where(eq(schema.reserva.id, id)))[0];
const ocupacoes = (id: string) => db.select().from(schema.ocupacao).where(eq(schema.ocupacao.reservaId, id));
const emails = (para: string) => enviarEmail.mock.calls.filter((c) => c[0] === `${para}@example.com`);

beforeAll(async () => {
  await garantirDocumentosIniciais();
});
beforeEach(() => {
  enviarEmail.mockReset();
  enviarEmail.mockResolvedValue(undefined);
});
afterAll(async () => {
  await f.limpar();
  await pool.end();
});

describe('cancelamento pela profissional', () => {
  it('com 48h ou mais: 100% do valor volta em crédito; horário e código liberados; Anfitrião avisado', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const id = await confirmada(espacoId, prof, anf);
    await db.update(schema.reserva).set({ codigoAcesso: '1234' }).where(eq(schema.reserva.id, id));

    const previa = await previaCancelamento(id, prof, agora);
    expect(previa).toMatchObject({ podeCancelar: true, pago: true, percentual: 100, creditoCentavos: 5000 });

    expect(await cancelarReservaPeloProfissional(id, prof, { ip: '203.0.113.9' }, agora)).toEqual({ creditoCentavos: 5000, percentual: 100 });
    expect(await reserva(id)).toMatchObject({ status: 'cancelada', canceladaPor: prof, codigoAcesso: null, creditoGeradoCentavos: 5000 });
    expect((await ocupacoes(id)).length).toBe(0);
    expect(await saldoDisponivel(prof, agora)).toBe(5000);
    expect(emails(prof).find((e) => e[1].includes('cancelada'))![2]).toContain('R$ 50,00');
    expect(emails(anf).some((e) => e[1].includes('cancelada pelo profissional'))).toBe(true);
    const [ev] = await db.select().from(schema.eventoAuditoria).where(eq(schema.eventoAuditoria.acao, 'reserva_cancelada_profissional'));
    expect(ev).toBeTruthy();
  });

  it('entre 24h e 48h: 50%; abaixo de 24h: sem crédito (e o e-mail explica)', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const meio = await confirmada(espacoId, prof, anf, 9, 10, 2);
    const inicioMeio = (await reserva(meio)).inicio;
    const trinta = new Date(inicioMeio.getTime() - 30 * HORA);
    expect(await cancelarReservaPeloProfissional(meio, prof, {}, trinta)).toEqual({ creditoCentavos: 2500, percentual: 50 });
    expect(await saldoDisponivel(prof, trinta)).toBe(2500);

    const outra = await f.profissional(); // outra pessoa: o crédito de cima abateria esta reserva (D8)
    const tarde = await confirmada(espacoId, outra, anf, 13, 14, 3);
    const dez = new Date((await reserva(tarde)).inicio.getTime() - 10 * HORA);
    enviarEmail.mockClear();
    expect(await cancelarReservaPeloProfissional(tarde, outra, {}, dez)).toEqual({ creditoCentavos: 0, percentual: 0 });
    expect(await saldoDisponivel(outra, dez)).toBe(0);
    expect(emails(outra).find((e) => e[1].includes('cancelada'))![2]).toContain('não há crédito');
    expect((await reserva(tarde)).creditoGeradoCentavos).toBeNull();
  });

  it('segue os números da sala, não valores fixos no código', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    await db.update(schema.regraEspaco).set({ cancelamentoIntegralHoras: 72, cancelamentoParcialHoras: 12, cancelamentoParcialPct: 30 }).where(eq(schema.regraEspaco.espacoId, espacoId));
    const id = await confirmada(espacoId, prof, anf);
    const inicio = (await reserva(id)).inicio;
    expect(await previaCancelamento(id, prof, new Date(inicio.getTime() - 60 * HORA))).toMatchObject({ percentual: 30, creditoCentavos: 1500 });
    expect(await previaCancelamento(id, prof, new Date(inicio.getTime() - 80 * HORA))).toMatchObject({ percentual: 100 });
  });

  it('o banco recusa uma política incoerente', async () => {
    const { espacoId } = await f.sala();
    await expect(db.update(schema.regraEspaco).set({ cancelamentoIntegralHoras: 10, cancelamentoParcialHoras: 20 }).where(eq(schema.regraEspaco.espacoId, espacoId))).rejects.toThrow();
    await expect(db.update(schema.regraEspaco).set({ cancelamentoParcialPct: 150 }).where(eq(schema.regraEspaco.espacoId, espacoId))).rejects.toThrow();
  });

  it('retirar pedido ainda sem resposta libera o horário, sem crédito e sem cobrança', async () => {
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    const id = await pedir(espacoId, prof);
    expect(await previaCancelamento(id, prof, agora)).toMatchObject({ podeCancelar: true, pago: false, creditoCentavos: 0 });
    expect(await cancelarReservaPeloProfissional(id, prof, {}, agora)).toEqual({ creditoCentavos: 0, percentual: 0 });
    expect((await reserva(id)).status).toBe('cancelada');
    expect((await ocupacoes(id)).length).toBe(0);
    expect(await saldoDisponivel(prof, agora)).toBe(0);
  });

  it('aprovada e não paga: não perde nada e o crédito que abatia volta', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    await concederCredito(db, { profissionalId: prof, espacoId, origem: 'ajuste_manual', valorCentavos: 2000 }, agora);
    const id = await pedir(espacoId, prof);
    await aprovarReserva(id, anf, {}, agora);
    expect(await saldoDisponivel(prof, agora)).toBe(0);
    expect(await cancelarReservaPeloProfissional(id, prof, {}, agora)).toEqual({ creditoCentavos: 0, percentual: 0 });
    expect(await saldoDisponivel(prof, agora)).toBe(2000);
  });

  it('não cancela a reserva de outra pessoa, nem uma já cancelada, nem uma que já começou', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const outra = await f.profissional();
    const id = await confirmada(espacoId, prof, anf);

    await expect(cancelarReservaPeloProfissional(id, outra, {}, agora)).rejects.toThrow(ReservaNaoEncontradaError);
    await expect(previaCancelamento(id, outra, agora)).rejects.toThrow(ReservaNaoEncontradaError);
    expect((await reserva(id)).status).toBe('confirmada');

    await expect(cancelarReservaPeloProfissional(id, prof, {}, h(9))).rejects.toThrow(ReservaJaIniciadaError);
    await cancelarReservaPeloProfissional(id, prof, {}, agora);
    await expect(cancelarReservaPeloProfissional(id, prof, {}, agora)).rejects.toThrow(EstadoReservaError);
    expect((await previaCancelamento(id, prof, agora)).podeCancelar).toBe(false);
  });

  it('dois cancelamentos ao mesmo tempo geram o crédito uma única vez', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const id = await confirmada(espacoId, prof, anf);
    const res = await Promise.allSettled([cancelarReservaPeloProfissional(id, prof, {}, agora), cancelarReservaPeloProfissional(id, prof, {}, agora)]);
    expect(res.filter((x) => x.status === 'fulfilled').length).toBe(1);
    expect(await saldoDisponivel(prof, agora)).toBe(5000);
    expect(emails(prof).filter((e) => e[1].includes('cancelada')).length).toBe(1);
  });
});
