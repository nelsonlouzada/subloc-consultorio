import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool, schema } from '@/db';

const enviarEmail = vi.fn<(para: string, assunto: string, html: string) => Promise<void>>();
vi.mock('@/lib/email', () => ({ enviarEmail: (...a: [string, string, string]) => enviarEmail(...a) }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

import { instanteLocal } from '@/lib/fuso';
import { concederCredito, creditoPorCancelamento, saldoDisponivel, usarCredito } from '@/modulos/carteira/carteira';
import { garantirDocumentosIniciais } from '@/modulos/configuracao/documentos-iniciais';
import { fabrica } from '@/test/fabrica';
import { cancelarReserva } from './cancelamento';
import { expirarPrazos } from './expiracao';
import { CreditoInsuficienteError, marcarPago } from './pagamento';
import { criarReserva } from './reserva';
import { aprovarReserva, EstadoReservaError } from './solicitacao';

const f = fabrica();
const ctx = { ip: '203.0.113.5', userAgent: 'vitest' };
const agora = instanteLocal(2026, 10, 20, 12);
const h = (hora: number, dia = 2, mes = 11) => instanteLocal(2026, mes, dia, hora);

async function pedir(espacoId: string, profissionalId: string, de = 9, ate = 10, dia = 2, usarCreditoPedido?: boolean) {
  const r = await criarReserva({ espacoId, profissionalId, inicio: h(de, dia), fim: h(ate, dia), unidade: 'hora', usarCredito: usarCreditoPedido }, ctx, agora);
  if (!r.ok) throw new Error(`pedido recusado: ${r.erro}`);
  return r.reservaId;
}
const reserva = async (id: string) => (await db.select().from(schema.reserva).where(eq(schema.reserva.id, id)))[0];
const ocupacoes = (id: string) => db.select().from(schema.ocupacao).where(eq(schema.ocupacao.reservaId, id));
const cobrancaDe = async (prof: string) => (await db.select().from(schema.cobranca).where(eq(schema.cobranca.profissionalId, prof)))[0];
const emailsPara = (prof: string) => enviarEmail.mock.calls.filter((c) => c[0] === `${prof}@example.com`);
const credito = (espacoId: string, prof: string, valorCentavos: number) =>
  concederCredito(db, { profissionalId: prof, espacoId, origem: 'ajuste_manual', valorCentavos }, agora);

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

describe('usar crédito no pedido (D8)', () => {
  it('o pedido liga o crédito por padrão e respeita quem desliga', async () => {
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    expect((await reserva(await pedir(espacoId, prof, 9, 10))).usarCredito).toBe(true);
    expect((await reserva(await pedir(espacoId, prof, 11, 12, 2, false))).usarCredito).toBe(false);
  });

  it('crédito parcial: abate na aprovação e o Pix é só o que falta', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    await credito(espacoId, prof, 2000);
    const id = await pedir(espacoId, prof);

    const r = await aprovarReserva(id, anf, {}, agora);
    expect(r).toMatchObject({ creditoUsado: 2000, valorAPagar: 3000, confirmada: false });
    expect(await reserva(id)).toMatchObject({ status: 'aguardando_pagamento' });
    expect(await cobrancaDe(prof)).toMatchObject({ status: 'pendente', valorCobradoCentavos: 3000, creditoUsadoCentavos: 2000 });
    expect(await saldoDisponivel(prof, agora)).toBe(0);

    const aprovada = emailsPara(prof).find((e) => e[1].includes('aprovada'))!;
    expect(aprovada[2]).toContain('R$ 30,00');
    expect(aprovada[2]).toContain('R$ 20,00');

    await marcarPago(id, anf, {}, agora);
    expect(emailsPara(prof).find((e) => e[1].includes('Pagamento recebido'))![2]).toContain('R$ 30,00');
  });

  it('crédito que cobre tudo: a reserva é confirmada na aprovação, sem Pix, e sobra saldo', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    await credito(espacoId, prof, 6000);
    const id = await pedir(espacoId, prof);

    expect(await aprovarReserva(id, anf, {}, agora)).toMatchObject({ creditoUsado: 5000, valorAPagar: 0, confirmada: true });
    expect(await reserva(id)).toMatchObject({ status: 'confirmada', prazoPagamentoAte: null });
    expect((await ocupacoes(id)).length).toBe(1);
    expect(await cobrancaDe(prof)).toMatchObject({ status: 'paga', meio: 'credito', valorCobradoCentavos: 0, creditoUsadoCentavos: 5000 });
    expect(await saldoDisponivel(prof, agora)).toBe(1000);
    expect(emailsPara(prof).some((e) => e[1].includes('confirmada com seu crédito'))).toBe(true);
    await expect(marcarPago(id, anf, {}, agora)).rejects.toThrow(EstadoReservaError);
  });

  it('com o crédito desligado nada é abatido', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    await credito(espacoId, prof, 9000);
    const id = await pedir(espacoId, prof, 9, 10, 2, false);
    expect(await aprovarReserva(id, anf, {}, agora)).toMatchObject({ creditoUsado: 0, valorAPagar: 5000 });
    expect(await saldoDisponivel(prof, agora)).toBe(9000);
  });

  it('duas aprovações ao mesmo tempo gastam o crédito uma única vez', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    await credito(espacoId, prof, 5000);
    const id = await pedir(espacoId, prof);
    const res = await Promise.allSettled([aprovarReserva(id, anf, {}, agora), aprovarReserva(id, anf, {}, agora)]);
    expect(res.filter((x) => x.status === 'fulfilled').length).toBe(1);
    expect(await saldoDisponivel(prof, agora)).toBe(0);
    const usos = await db.select().from(schema.creditoMovimento).where(eq(schema.creditoMovimento.reservaId, id));
    expect(usos.reduce((s, m) => s + m.valorCentavos, 0)).toBe(-5000);
  });

  it('pedido que expira sem pagamento devolve o crédito, uma única vez', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    await credito(espacoId, prof, 2000);
    const id = await pedir(espacoId, prof);
    await aprovarReserva(id, anf, {}, agora);
    expect(await saldoDisponivel(prof, agora)).toBe(0);

    const depois = new Date(agora.getTime() + 4 * 3_600_000);
    await expirarPrazos(depois);
    expect((await reserva(id)).status).toBe('expirada');
    expect(await saldoDisponivel(prof, depois)).toBe(2000);
    await expirarPrazos(depois);
    expect(await saldoDisponivel(prof, depois)).toBe(2000);
  });

  it('cancelar uma reserva aprovada e não paga devolve o crédito sem criar lote novo', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    await credito(espacoId, prof, 2000);
    const id = await pedir(espacoId, prof);
    await aprovarReserva(id, anf, {}, agora);

    expect(await cancelarReserva(id, anf, null, {}, agora)).toEqual({ creditoCentavos: 0 });
    expect(await saldoDisponivel(prof, agora)).toBe(2000);
    const lotes = await db.select().from(schema.creditoLote).where(eq(schema.creditoLote.profissionalId, prof));
    expect(lotes.length).toBe(1);
  });

  it('cancelar reserva paga só com crédito devolve o valor inteiro como novo crédito', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    await credito(espacoId, prof, 5000);
    const id = await pedir(espacoId, prof);
    await aprovarReserva(id, anf, {}, agora);
    expect(await saldoDisponivel(prof, agora)).toBe(0);
    expect(await cancelarReserva(id, anf, null, {}, agora)).toEqual({ creditoCentavos: 5000 });
    expect(await saldoDisponivel(prof, agora)).toBe(5000);
  });

  it('Pix atrasado: reativa abatendo o crédito de novo; sem saldo, desfaz tudo', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const depois = new Date(agora.getTime() + 4 * 3_600_000);

    const com = await f.profissional();
    await credito(espacoId, com, 2000);
    const idCom = await pedir(espacoId, com, 9, 10, 2);
    await aprovarReserva(idCom, anf, {}, agora);
    await expirarPrazos(depois);
    expect(await marcarPago(idCom, anf, {}, depois)).toEqual({ reativada: true });
    expect(await saldoDisponivel(com, depois)).toBe(0);

    const sem = await f.profissional();
    await credito(espacoId, sem, 2000);
    const idSem = await pedir(espacoId, sem, 13, 14, 3);
    await aprovarReserva(idSem, anf, {}, agora);
    await expirarPrazos(depois);
    await db.transaction((tx) => usarCredito(tx, { profissionalId: sem, ate: 2000 }, depois)); // gastou o crédito devolvido
    await expect(marcarPago(idSem, anf, {}, depois)).rejects.toThrow(CreditoInsuficienteError);
    expect((await reserva(idSem)).status).toBe('expirada');
    expect((await ocupacoes(idSem)).length).toBe(0);
  });
});

describe('política de cancelamento', () => {
  const politica = { integralHoras: 48, parcialHoras: 24, parcialPct: 50 };
  const inicio = new Date(agora.getTime() + 100 * 3_600_000);
  const antes = (horas: number) => new Date(inicio.getTime() - horas * 3_600_000);

  it('100% com 48h ou mais, 50% de 24h a 48h, nada abaixo de 24h', () => {
    expect(creditoPorCancelamento(politica, inicio, antes(72), 5000)).toEqual({ percentual: 100, creditoCentavos: 5000 });
    expect(creditoPorCancelamento(politica, inicio, antes(48), 5000)).toEqual({ percentual: 100, creditoCentavos: 5000 });
    expect(creditoPorCancelamento(politica, inicio, antes(47.9), 5000)).toEqual({ percentual: 50, creditoCentavos: 2500 });
    expect(creditoPorCancelamento(politica, inicio, antes(24), 5000)).toEqual({ percentual: 50, creditoCentavos: 2500 });
    expect(creditoPorCancelamento(politica, inicio, antes(23.9), 5000)).toEqual({ percentual: 0, creditoCentavos: 0 });
  });

  it('arredonda para baixo e usa os números da sala', () => {
    expect(creditoPorCancelamento(politica, inicio, antes(30), 3333).creditoCentavos).toBe(1666);
    expect(creditoPorCancelamento({ integralHoras: 72, parcialHoras: 12, parcialPct: 30 }, inicio, antes(60), 1000)).toEqual({ percentual: 30, creditoCentavos: 300 });
  });
});
