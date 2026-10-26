import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool, schema } from '@/db';

const enviarEmail = vi.fn<(para: string, assunto: string, html: string) => Promise<void>>();
vi.mock('@/lib/email', () => ({ enviarEmail: (...a: [string, string, string]) => enviarEmail(...a) }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

import { type DataLocal, instanteLocal } from '@/lib/fuso';
import { concederCredito, saldoDisponivel } from '@/modulos/carteira/carteira';
import { aplicarEventoAsaas } from '@/modulos/cobranca/webhook';
import { garantirDocumentosIniciais } from '@/modulos/configuracao/documentos-iniciais';
import { fabrica } from '@/test/fabrica';
import { expirarPrazos } from './expiracao';
import { criarReserva } from './reserva';
import { aprovarSerie, recusarSerie } from './serie-aprovacao';
import { gerarCobrancasDaSerie, gerarCobrancasPendentes } from './serie-cobranca';
import { marcarPagoCobrancaDeSerie } from './serie-pagamento';
import { criarSerie, type PedidoSerie } from './serie';
import { CadastroPendenteError, EstadoReservaError, PrazoVencidoError } from './solicitacao';

const f = fabrica();
const ctx = { ip: '203.0.113.5', userAgent: 'vitest' };
const HORA = 3_600_000;
const agora = instanteLocal(2026, 10, 20, 12); // terça-feira
const d = (ano: number, mes: number, dia: number): DataLocal => ({ ano, mes, dia });

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

const pedido = (espacoId: string, profissionalId: string, extra: Partial<PedidoSerie> = {}): PedidoSerie => ({
  espacoId,
  profissionalId,
  diasSemana: [2, 4], // terça e quinta
  frequencia: 'semanal',
  unidade: 'hora',
  horaInicio: 9,
  horaFim: 10,
  dataInicio: d(2026, 10, 27),
  dataFim: d(2026, 11, 17), // 7 datas: 27/10, 29/10 | 03/11, 05/11, 10/11, 12/11, 17/11
  formaPagamento: 'por_ocorrencia',
  ...extra,
});

async function nova(forma: 'pacote_mes' | 'por_ocorrencia', opcoes: { profissional?: string; status?: 'aprovado' | 'pendente' } = {}) {
  const { espacoId } = await f.sala();
  const anf = await f.anfitriao();
  const prof = opcoes.profissional ?? (await f.profissional(opcoes.status ?? 'aprovado'));
  const r = await criarSerie(pedido(espacoId, prof, { formaPagamento: forma }), ctx, agora);
  if (!r.ok) throw new Error(r.erro);
  return { espacoId, anf, prof, serieId: r.serieId };
}
const reservas = (serieId: string) => db.select().from(schema.reserva).where(eq(schema.reserva.serieId, serieId)).orderBy(schema.reserva.inicio);
const statusDe = async (serieId: string) => (await reservas(serieId)).map((r) => r.status);
const cobrancas = async (prof: string) => db.select().from(schema.cobranca).where(eq(schema.cobranca.profissionalId, prof)).orderBy(schema.cobranca.criadoEm);
const itensDe = (cobrancaId: string) => db.select().from(schema.cobrancaItem).where(eq(schema.cobrancaItem.cobrancaId, cobrancaId));
const serieDe = async (id: string) => (await db.select().from(schema.serie).where(eq(schema.serie.id, id)))[0];
const emails = (prof: string) => enviarEmail.mock.calls.filter((c) => c[0] === `${prof}@example.com`);

describe('aprovar e recusar série', () => {
  it('aprova a série inteira: as datas ficam aprovadas, o horário segue retido e nada é cobrado antes da hora', async () => {
    const { serieId, anf, prof } = await nova('por_ocorrencia');
    const r = await aprovarSerie(serieId, anf, {}, agora);

    expect(r).toEqual({ ocorrencias: 7, cobrancas: 0 }); // a primeira data está a mais de 3 dias
    expect(await statusDe(serieId)).toEqual(Array(7).fill('aprovada'));
    expect(await serieDe(serieId)).toMatchObject({ status: 'aprovada', aprovadaPor: anf });
    expect((await db.select().from(schema.ocupacao).where(eq(schema.ocupacao.reservaId, (await reservas(serieId))[0].id))).length).toBe(1);
    expect(await cobrancas(prof)).toHaveLength(0);
    const email = emails(prof).find((e) => e[1].includes('Sua série foi aprovada'))!;
    expect(email[2]).toContain('toda terça e quinta');
    expect(email[2]).toContain('7 datas');
  });

  it('só uma decisão por série, mesmo com dois cliques ao mesmo tempo, e não aprova depois de recusada', async () => {
    const { serieId, anf } = await nova('por_ocorrencia');
    const res = await Promise.allSettled([aprovarSerie(serieId, anf, {}, agora), aprovarSerie(serieId, anf, {}, agora)]);
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    await expect(aprovarSerie(serieId, anf, {}, agora)).rejects.toThrow(EstadoReservaError);
    await expect(recusarSerie(serieId, anf, null, {}, agora)).rejects.toThrow(EstadoReservaError);
  });

  it('cadastro pendente só aprova junto; depois do prazo não aprova mais', async () => {
    const { serieId, anf, prof } = await nova('por_ocorrencia', { status: 'pendente' });
    await expect(aprovarSerie(serieId, anf, {}, agora)).rejects.toThrow(CadastroPendenteError);
    await expect(aprovarSerie(serieId, anf, { aprovarCadastro: true }, new Date(agora.getTime() + 13 * HORA))).rejects.toThrow(PrazoVencidoError);
    expect((await serieDe(serieId)).status).toBe('solicitada');

    await aprovarSerie(serieId, anf, { aprovarCadastro: true }, agora);
    const [p] = await db.select().from(schema.profissional).where(eq(schema.profissional.usuarioId, prof));
    expect(p.status).toBe('aprovado');
    expect((await serieDe(serieId)).status).toBe('aprovada');
  });

  it('recusar libera todas as datas e avisa com o motivo', async () => {
    const { serieId, anf, prof, espacoId } = await nova('pacote_mes');
    await recusarSerie(serieId, anf, 'Sala em reforma', {}, agora);
    expect(await statusDe(serieId)).toEqual(Array(7).fill('recusada'));
    expect((await serieDe(serieId)).status).toBe('recusada');
    expect(await db.select().from(schema.ocupacao).where(eq(schema.ocupacao.espacoId, espacoId))).toHaveLength(0);
    expect(emails(prof).find((e) => e[1].includes('não foi aprovada'))![2]).toContain('Sala em reforma');
  });

  it('série sem resposta expira inteira, e a série vira expirada', async () => {
    const { serieId, espacoId } = await nova('por_ocorrencia');
    await expirarPrazos(new Date(agora.getTime() + 13 * HORA));
    expect(await statusDe(serieId)).toEqual(Array(7).fill('expirada'));
    expect((await serieDe(serieId)).status).toBe('expirada');
    expect(await db.select().from(schema.ocupacao).where(eq(schema.ocupacao.espacoId, espacoId))).toHaveLength(0);
  });
});

describe('cobrança por ocorrência', () => {
  it('gera o link de cada data só 3 dias antes, uma vez, com prazo até 6h antes do início', async () => {
    const { serieId, anf, prof } = await nova('por_ocorrencia');
    await aprovarSerie(serieId, anf, {}, agora);

    const dia25 = instanteLocal(2026, 10, 25, 12);
    expect(await gerarCobrancasDaSerie(serieId, {}, dia25)).toBe(1); // só a de 27/10 cabe nos 3 dias
    const [c] = await cobrancas(prof);
    expect(c).toMatchObject({ finalidade: 'ocorrencia', status: 'pendente', valorCobradoCentavos: 5000, valorBrutoCentavos: 5000, descontoCentavos: 0 });
    expect(c.venceEm!.getTime()).toBe(instanteLocal(2026, 10, 27, 3).getTime()); // 9h do início menos 6h
    const rs = await reservas(serieId);
    expect(rs.map((r) => r.status)).toEqual(['aguardando_pagamento', ...Array(6).fill('aprovada')]);
    expect(rs[0].prazoPagamentoAte!.getTime()).toBe(c.venceEm!.getTime());
    expect(await itensDe(c.id)).toHaveLength(1);
    const email = emails(prof).find((e) => e[1].includes('Pagamento de uma data'))!;
    expect(email[2]).toContain('R$ 50,00');

    // De novo, no mesmo instante: nada novo. Dois dias depois: as de 29/10 e a próxima semana entram aos poucos.
    expect(await gerarCobrancasDaSerie(serieId, {}, dia25)).toBe(0);
    expect(await gerarCobrancasPendentes(instanteLocal(2026, 10, 27, 12))).toBeGreaterThanOrEqual(1);
    expect((await cobrancas(prof)).length).toBe(2);
  });

  it('dois processos gerando a cobrança ao mesmo tempo: só uma cobrança sai, e o crédito não é gasto em dobro', async () => {
    const { serieId, anf, prof, espacoId } = await nova('por_ocorrencia');
    await concederCredito(db, { profissionalId: prof, espacoId, origem: 'ajuste_manual', valorCentavos: 2000 }, agora);
    await aprovarSerie(serieId, anf, {}, agora);
    const dia25 = instanteLocal(2026, 10, 25, 12);
    const criadas = await Promise.all([gerarCobrancasDaSerie(serieId, {}, dia25), gerarCobrancasDaSerie(serieId, {}, dia25)]);
    expect(criadas.reduce((a, b) => a + b, 0)).toBe(1);
    const todas = await cobrancas(prof);
    expect(todas).toHaveLength(1);
    expect(todas[0]).toMatchObject({ creditoUsadoCentavos: 2000, valorCobradoCentavos: 3000 });
    expect(await saldoDisponivel(prof, dia25)).toBe(0);
    expect((await emails(prof)).filter((e) => e[1].includes('Pagamento de uma data'))).toHaveLength(1);
  });

  it('pagar a data confirma só ela; recibo e e-mail saem uma vez', async () => {
    const { serieId, anf, prof } = await nova('por_ocorrencia');
    await aprovarSerie(serieId, anf, {}, agora);
    await gerarCobrancasDaSerie(serieId, {}, instanteLocal(2026, 10, 25, 12));
    const [c] = await cobrancas(prof);

    const r = await marcarPagoCobrancaDeSerie(c.id, anf, {}, instanteLocal(2026, 10, 25, 13));
    expect(r).toEqual({ confirmadas: 1, viraramCredito: 0, creditoCentavos: 0 });
    expect((await statusDe(serieId))[0]).toBe('confirmada');
    expect(await cobrancas(prof)).toMatchObject([{ status: 'paga', meio: 'pix_manual', marcadaPagaPor: anf }]);
    expect((await db.select().from(schema.recibo).where(eq(schema.recibo.cobrancaId, c.id))).length).toBe(1);
    expect(emails(prof).filter((e) => e[1].includes('série está confirmada'))).toHaveLength(1);
    expect(await marcarPagoCobrancaDeSerie(c.id, anf, {}, agora)).toBeNull(); // não paga duas vezes
  });
});

describe('cobrança por pacote do mês', () => {
  it('na aprovação cobra o primeiro mês inteiro (já com 10% de desconto); os outros meses vêm depois', async () => {
    const { serieId, anf, prof } = await nova('pacote_mes');
    const r = await aprovarSerie(serieId, anf, {}, agora);
    expect(r).toEqual({ ocorrencias: 7, cobrancas: 1 });

    const [c] = await cobrancas(prof);
    expect(c).toMatchObject({ finalidade: 'pacote_mes', status: 'pendente', valorBrutoCentavos: 10000, descontoCentavos: 1000, valorCobradoCentavos: 9000 });
    expect(await itensDe(c.id)).toHaveLength(2); // 27/10 e 29/10
    expect(c.venceEm!.getTime()).toBe(agora.getTime() + 2 * HORA); // D3: 2h para pagar
    expect(await statusDe(serieId)).toEqual(['aguardando_pagamento', 'aguardando_pagamento', ...Array(5).fill('aprovada')]);
    expect(emails(prof).find((e) => e[1].includes('pacote do mês'))![2]).toContain('R$ 90,00');

    // Em 1º de novembro o pacote de novembro (5 datas) entra, com prazo mais folgado.
    const dia1 = instanteLocal(2026, 11, 1, 10);
    expect(await gerarCobrancasDaSerie(serieId, {}, dia1)).toBe(1);
    const todas = await cobrancas(prof);
    expect(todas).toHaveLength(2);
    expect(todas[1]).toMatchObject({ valorCobradoCentavos: 22500, valorBrutoCentavos: 25000, descontoCentavos: 2500 });
    expect(await itensDe(todas[1].id)).toHaveLength(5);
  });

  it('pagar o pacote confirma todas as datas do mês de uma vez', async () => {
    const { serieId, anf, prof } = await nova('pacote_mes');
    await aprovarSerie(serieId, anf, {}, agora);
    const [c] = await cobrancas(prof);
    expect(await marcarPagoCobrancaDeSerie(c.id, anf, {}, agora)).toEqual({ confirmadas: 2, viraramCredito: 0, creditoCentavos: 0 });
    expect((await statusDe(serieId)).slice(0, 2)).toEqual(['confirmada', 'confirmada']);
    const e = emails(prof).find((x) => x[1].includes('série está confirmada'))!;
    expect(e[2]).toContain('as 2 reservas');
  });

  it('o aviso do Asaas confirma o pacote inteiro, uma vez só', async () => {
    const { serieId, anf, prof } = await nova('pacote_mes');
    await aprovarSerie(serieId, anf, {}, agora);
    const [c] = await cobrancas(prof);
    await db.update(schema.cobranca).set({ asaasCobrancaId: `pay_${serieId.slice(0, 8)}` }).where(eq(schema.cobranca.id, c.id));
    const evento = { event: 'PAYMENT_RECEIVED', payment: { id: `pay_${serieId.slice(0, 8)}`, value: 90, billingType: 'PIX', externalReference: c.id } };

    expect((await aplicarEventoAsaas(evento, agora)).situacao).toBe('processado');
    expect((await statusDe(serieId)).slice(0, 2)).toEqual(['confirmada', 'confirmada']);
    expect((await aplicarEventoAsaas(evento, agora)).situacao).toBe('ignorado'); // já paga
    expect((await db.select().from(schema.recibo).where(eq(schema.recibo.cobrancaId, c.id))).length).toBe(1);
    expect((await cobrancas(prof))[0]).toMatchObject({ meio: 'pix', marcadaPagaPor: null });
  });
});

describe('crédito, expiração e pagamento atrasado em série', () => {
  it('o crédito abate o pacote na geração; se cobre tudo, as datas já saem confirmadas', async () => {
    const { serieId, anf, prof, espacoId } = await nova('pacote_mes');
    await concederCredito(db, { profissionalId: prof, espacoId, origem: 'ajuste_manual', valorCentavos: 20000 }, agora);
    await aprovarSerie(serieId, anf, {}, agora);

    const [c] = await cobrancas(prof);
    expect(c).toMatchObject({ status: 'paga', meio: 'credito', creditoUsadoCentavos: 9000, valorCobradoCentavos: 0 });
    expect((await statusDe(serieId)).slice(0, 2)).toEqual(['confirmada', 'confirmada']);
    expect(await saldoDisponivel(prof, agora)).toBe(11000);
    expect(emails(prof).some((e) => e[1].includes('confirmada com o seu crédito'))).toBe(true);
    expect((await db.select().from(schema.recibo).where(eq(schema.recibo.cobrancaId, c.id))).length).toBe(0); // sem dinheiro novo, sem recibo
  });

  it('crédito parcial: o Pix é só o que falta, e o crédito volta se o pacote expira', async () => {
    const { serieId, anf, prof, espacoId } = await nova('pacote_mes');
    await concederCredito(db, { profissionalId: prof, espacoId, origem: 'ajuste_manual', valorCentavos: 3000 }, agora);
    await aprovarSerie(serieId, anf, {}, agora);
    const [c] = await cobrancas(prof);
    expect(c).toMatchObject({ creditoUsadoCentavos: 3000, valorCobradoCentavos: 6000, status: 'pendente' });
    expect(await saldoDisponivel(prof, agora)).toBe(0);

    const depois = new Date(agora.getTime() + 3 * HORA);
    await expirarPrazos(depois);
    expect((await statusDe(serieId)).slice(0, 2)).toEqual(['expirada', 'expirada']);
    expect((await cobrancas(prof))[0].status).toBe('expirada');
    expect(await saldoDisponivel(prof, depois)).toBe(3000);
    await expirarPrazos(depois);
    expect(await saldoDisponivel(prof, depois)).toBe(3000); // devolvido uma vez só
  });

  it('Pix do pacote chega atrasado: as datas livres voltam e a que foi tomada vira crédito', async () => {
    const { serieId, anf, prof, espacoId } = await nova('pacote_mes');
    await aprovarSerie(serieId, anf, {}, agora);
    const depois = new Date(agora.getTime() + 3 * HORA);
    await expirarPrazos(depois);
    // Outra pessoa pega a quinta, 29/10, às 9h.
    const outra = await f.profissional();
    const tomada = await criarReserva({ espacoId, profissionalId: outra, inicio: instanteLocal(2026, 10, 29, 9), fim: instanteLocal(2026, 10, 29, 10), unidade: 'hora' }, ctx, depois);
    expect(tomada.ok).toBe(true);

    const [c] = await cobrancas(prof);
    expect(await marcarPagoCobrancaDeSerie(c.id, anf, {}, depois)).toEqual({ confirmadas: 1, viraramCredito: 1, creditoCentavos: 4500 });
    expect((await statusDe(serieId)).slice(0, 2)).toEqual(['confirmada', 'expirada']);
    expect(await saldoDisponivel(prof, depois)).toBe(4500);
    expect(emails(prof).some((e) => e[1].includes('virou crédito'))).toBe(true);
  });

  it('pacote atrasado sem saldo para reabater o crédito: o dinheiro que chegou vira crédito, sem erro', async () => {
    const { serieId, anf, prof, espacoId } = await nova('pacote_mes');
    await concederCredito(db, { profissionalId: prof, espacoId, origem: 'ajuste_manual', valorCentavos: 3000 }, agora);
    await aprovarSerie(serieId, anf, {}, agora);
    const depois = new Date(agora.getTime() + 3 * HORA);
    await expirarPrazos(depois); // devolve os R$ 30
    const { usarCredito } = await import('@/modulos/carteira/carteira');
    await db.transaction((tx) => usarCredito(tx, { profissionalId: prof, ate: 3000 }, depois)); // a pessoa gastou o crédito devolvido

    const [c] = await cobrancas(prof);
    const r = await marcarPagoCobrancaDeSerie(c.id, anf, {}, depois);
    expect(r).toMatchObject({ confirmadas: 0, creditoCentavos: 6000 }); // o Pix de R$ 60 vira crédito
    expect(await saldoDisponivel(prof, depois)).toBe(6000);
    expect((await cobrancas(prof))[0].status).toBe('paga');
    expect((await statusDe(serieId)).slice(0, 2)).toEqual(['expirada', 'expirada']);
  });

  it('data aprovada que ficou sem cobrança e está perto demais do início é liberada', async () => {
    const { serieId, anf, espacoId } = await nova('por_ocorrencia');
    await aprovarSerie(serieId, anf, {}, agora);
    // Faltam 5h para a primeira data (27/10 às 9h): já passou do corte de 6h.
    const quase = instanteLocal(2026, 10, 27, 4);
    await expirarPrazos(quase);
    expect((await statusDe(serieId))[0]).toBe('expirada');
    expect((await statusDe(serieId))[1]).toBe('aprovada');
    const ocupacoes = await db.select().from(schema.ocupacao).where(eq(schema.ocupacao.espacoId, espacoId));
    expect(ocupacoes).toHaveLength(6);
  });
});
