import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool, schema } from '@/db';

const enviarEmail = vi.fn<(para: string, assunto: string, html: string) => Promise<void>>();
vi.mock('@/lib/email', () => ({ enviarEmail: (...a: [string, string, string]) => enviarEmail(...a) }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

import { type DataLocal, formatarDataISO, instanteLocal } from '@/lib/fuso';
import { concederCredito, saldoDisponivel } from '@/modulos/carteira/carteira';
import { garantirDocumentosIniciais } from '@/modulos/configuracao/documentos-iniciais';
import { fabrica } from '@/test/fabrica';
import { cancelarReserva, cancelarReservaPeloProfissional, estaEmPacoteNaoPago, OcorrenciaEmPacoteError, previaCancelamento } from './cancelamento';
import { aprovarSerie } from './serie-aprovacao';
import { cancelarSerie } from './serie-cancelamento';
import { gerarCobrancasDaSerie } from './serie-cobranca';
import { marcarPagoCobrancaDeSerie } from './serie-pagamento';
import { avisarRenovacaoDeSeries, dadosDaRenovacao, periodoDaRenovacao } from './serie-renovacao';
import { criarSerie, type PedidoSerie } from './serie';
import { EstadoReservaError, ReservaNaoEncontradaError } from './solicitacao';

const f = fabrica();
const ctx = { ip: '203.0.113.5', userAgent: 'vitest' };
const agora = instanteLocal(2026, 10, 20, 12); // terça-feira
const d = (ano: number, mes: number, dia: number): DataLocal => ({ ano, mes, dia });
const iso = (x: DataLocal) => formatarDataISO(x);

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
  diasSemana: [2, 4],
  frequencia: 'semanal',
  unidade: 'hora',
  horaInicio: 9,
  horaFim: 10,
  dataInicio: d(2026, 10, 27),
  dataFim: d(2026, 11, 17),
  formaPagamento: 'por_ocorrencia',
  ...extra,
});

/** Série aprovada. Com `pagarPrimeira`, a data de 27/10 é cobrada (em 25/10) e paga. */
async function aprovada(forma: 'pacote_mes' | 'por_ocorrencia', opcoes: { pagarPrimeira?: boolean; usuario?: string } = {}) {
  const { espacoId } = await f.sala();
  const anf = await f.anfitriao();
  const prof = opcoes.usuario ?? (await f.profissional());
  const r = await criarSerie(pedido(espacoId, prof, { formaPagamento: forma }), ctx, agora);
  if (!r.ok) throw new Error(r.erro);
  await aprovarSerie(r.serieId, anf, {}, agora);
  if (opcoes.pagarPrimeira) {
    const dia25 = instanteLocal(2026, 10, 25, 12);
    if (forma === 'por_ocorrencia') await gerarCobrancasDaSerie(r.serieId, {}, dia25);
    const [c] = await cobrancas(prof);
    await marcarPagoCobrancaDeSerie(c.id, anf, {}, dia25);
  }
  return { espacoId, anf, prof, serieId: r.serieId };
}
const reservas = (serieId: string) => db.select().from(schema.reserva).where(eq(schema.reserva.serieId, serieId)).orderBy(schema.reserva.inicio);
const statusDe = async (serieId: string) => (await reservas(serieId)).map((r) => r.status);
const cobrancas = (prof: string) => db.select().from(schema.cobranca).where(eq(schema.cobranca.profissionalId, prof)).orderBy(schema.cobranca.criadoEm);
const serieDe = async (id: string) => (await db.select().from(schema.serie).where(eq(schema.serie.id, id)))[0];
const emails = (para: string) => enviarEmail.mock.calls.filter((c) => c[0] === `${para}@example.com`);

describe('cancelar a série inteira', () => {
  it('pela profissional: datas liberadas e o crédito da data paga segue a política (50% entre 24h e 48h)', async () => {
    const { serieId, anf, prof, espacoId } = await aprovada('por_ocorrencia', { pagarPrimeira: true });
    const quando = instanteLocal(2026, 10, 25, 13); // 44h antes de 27/10 às 9h

    const r = await cancelarSerie(serieId, { id: prof, papel: 'profissional' }, { ip: '203.0.113.9' }, quando);
    expect(r).toEqual({ canceladas: 7, creditoCentavos: 2500 });
    expect(await statusDe(serieId)).toEqual(Array(7).fill('cancelada'));
    expect((await serieDe(serieId)).status).toBe('cancelada');
    expect(await db.select().from(schema.ocupacao).where(eq(schema.ocupacao.espacoId, espacoId))).toHaveLength(0);
    expect(await saldoDisponivel(prof, quando)).toBe(2500);
    expect((await reservas(serieId))[0]).toMatchObject({ canceladaPor: prof, creditoGeradoCentavos: 2500 });
    expect(emails(prof).find((e) => e[1] === 'Série cancelada')![2]).toContain('R$ 25,00');
    expect(emails(anf).some((e) => e[1].includes('Série cancelada pelo profissional'))).toBe(true);
    const [ev] = await db.select().from(schema.eventoAuditoria).where(eq(schema.eventoAuditoria.acao, 'serie_cancelada_profissional'));
    expect(ev).toBeTruthy();
  });

  it('pelo Anfitrião: crédito integral nas datas pagas', async () => {
    const { serieId, anf, prof } = await aprovada('por_ocorrencia', { pagarPrimeira: true });
    const quando = instanteLocal(2026, 10, 25, 13);
    expect(await cancelarSerie(serieId, { id: anf, papel: 'anfitriao' }, {}, quando)).toEqual({ canceladas: 7, creditoCentavos: 5000 });
    expect(await saldoDisponivel(prof, quando)).toBe(5000);
    expect(emails(prof).some((e) => e[2].includes('Os responsáveis pela sala cancelaram'))).toBe(true);
  });

  it('pacote do mês já pago: cada data paga volta como crédito pela política, pela própria antecedência', async () => {
    const { serieId, prof } = await aprovada('pacote_mes', { pagarPrimeira: true });
    const [c] = await cobrancas(prof);
    expect(c.status).toBe('paga'); // 27/10 e 29/10, R$ 45 cada
    const r = await cancelarSerie(serieId, { id: prof, papel: 'profissional' }, {}, agora); // mais de 48h antes: 100%
    expect(r).toEqual({ canceladas: 7, creditoCentavos: 9000 });
    expect(await saldoDisponivel(prof, agora)).toBe(9000);
  });

  it('cobrança aberta é cancelada e o crédito que a abatia volta', async () => {
    const { espacoId, anf, prof } = await (async () => {
      const { espacoId } = await f.sala();
      const anf = await f.anfitriao();
      const prof = await f.profissional();
      await concederCredito(db, { profissionalId: prof, espacoId, origem: 'ajuste_manual', valorCentavos: 3000 }, agora);
      return { espacoId, anf, prof };
    })();
    const s = await criarSerie(pedido(espacoId, prof, { formaPagamento: 'pacote_mes' }), ctx, agora);
    if (!s.ok) throw new Error(s.erro);
    await aprovarSerie(s.serieId, anf, {}, agora);
    expect(await saldoDisponivel(prof, agora)).toBe(0);
    expect((await cobrancas(prof))[0]).toMatchObject({ status: 'pendente', creditoUsadoCentavos: 3000 });

    const r = await cancelarSerie(s.serieId, { id: prof, papel: 'profissional' }, {}, agora);
    expect(r).toEqual({ canceladas: 7, creditoCentavos: 0 });
    expect((await cobrancas(prof))[0].status).toBe('cancelada');
    expect(await saldoDisponivel(prof, agora)).toBe(3000);
  });

  it('pedido de série ainda sem resposta pode ser retirado; datas já passadas ficam como estão', async () => {
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    const s = await criarSerie(pedido(espacoId, prof), ctx, agora);
    if (!s.ok) throw new Error(s.erro);
    expect(await cancelarSerie(s.serieId, { id: prof, papel: 'profissional' }, {}, agora)).toEqual({ canceladas: 7, creditoCentavos: 0 });
    expect(await statusDe(s.serieId)).toEqual(Array(7).fill('cancelada'));

    // Série em andamento: depois de 27/10 às 9h, a primeira data (paga e confirmada) já passou e não é tocada.
    const { serieId, anf, prof: p2 } = await aprovada('por_ocorrencia', { pagarPrimeira: true });
    const depois = instanteLocal(2026, 10, 28, 12);
    expect(await cancelarSerie(serieId, { id: anf, papel: 'anfitriao' }, {}, depois)).toEqual({ canceladas: 6, creditoCentavos: 0 });
    expect(await statusDe(serieId)).toEqual(['confirmada', ...Array(6).fill('cancelada')]);
    expect(await saldoDisponivel(p2, depois)).toBe(0);
  });

  it('não cancela série de outra pessoa, nem série já cancelada ou recusada', async () => {
    const { serieId, prof } = await aprovada('por_ocorrencia');
    const outra = await f.profissional();
    await expect(cancelarSerie(serieId, { id: outra, papel: 'profissional' }, {}, agora)).rejects.toThrow(ReservaNaoEncontradaError);
    expect((await serieDe(serieId)).status).toBe('aprovada');
    await cancelarSerie(serieId, { id: prof, papel: 'profissional' }, {}, agora);
    await expect(cancelarSerie(serieId, { id: prof, papel: 'profissional' }, {}, agora)).rejects.toThrow(EstadoReservaError);
  });

  it('dois cancelamentos ao mesmo tempo: só um vale, e o crédito sai uma vez', async () => {
    const { serieId, prof } = await aprovada('por_ocorrencia', { pagarPrimeira: true });
    const quando = instanteLocal(2026, 10, 25, 13);
    const res = await Promise.allSettled([cancelarSerie(serieId, { id: prof, papel: 'profissional' }, {}, quando), cancelarSerie(serieId, { id: prof, papel: 'profissional' }, {}, quando)]);
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await saldoDisponivel(prof, quando)).toBe(2500);
  });
});

describe('cancelar uma data da série', () => {
  it('data aprovada, sem cobrança, cancela sem dinheiro envolvido; a série segue com as outras', async () => {
    const { serieId, prof } = await aprovada('por_ocorrencia');
    const [primeira] = await reservas(serieId);
    expect(await previaCancelamento(primeira.id, prof, agora)).toMatchObject({ podeCancelar: true, pago: false, creditoCentavos: 0 });
    expect(await cancelarReservaPeloProfissional(primeira.id, prof, {}, agora)).toEqual({ creditoCentavos: 0, percentual: 0 });
    expect(await statusDe(serieId)).toEqual(['cancelada', ...Array(6).fill('aprovada')]);
    expect((await serieDe(serieId)).status).toBe('aprovada');
  });

  it('data de pacote do mês ainda não pago não sai sozinha: é preciso cancelar a série ou esperar', async () => {
    const { serieId, prof, anf } = await aprovada('pacote_mes');
    const [primeira] = await reservas(serieId);
    expect(primeira.status).toBe('aguardando_pagamento');
    expect(await estaEmPacoteNaoPago(primeira)).toBe(true);
    expect(await previaCancelamento(primeira.id, prof, agora)).toMatchObject({ podeCancelar: false, emPacote: true });
    await expect(cancelarReservaPeloProfissional(primeira.id, prof, {}, agora)).rejects.toThrow(OcorrenciaEmPacoteError);
    await expect(cancelarReserva(primeira.id, anf, null, {}, agora)).rejects.toThrow(OcorrenciaEmPacoteError);
    expect((await reservas(serieId))[0].status).toBe('aguardando_pagamento');
  });

  it('data de pacote já pago segue a política como qualquer reserva paga', async () => {
    const { serieId, prof } = await aprovada('pacote_mes', { pagarPrimeira: true });
    const [primeira] = await reservas(serieId);
    expect(await cancelarReservaPeloProfissional(primeira.id, prof, {}, agora)).toEqual({ creditoCentavos: 4500, percentual: 100 }); // o valor com desconto
    expect(await saldoDisponivel(prof, agora)).toBe(4500);
  });

  it('data de série por ocorrência, aguardando pagamento sozinha, cancela e cancela a cobrança dela', async () => {
    const { serieId, prof } = await aprovada('por_ocorrencia');
    const dia25 = instanteLocal(2026, 10, 25, 12);
    await gerarCobrancasDaSerie(serieId, {}, dia25);
    const [primeira] = await reservas(serieId);
    expect(primeira.status).toBe('aguardando_pagamento');
    expect(await estaEmPacoteNaoPago(primeira)).toBe(false);
    await cancelarReservaPeloProfissional(primeira.id, prof, {}, dia25);
    expect((await cobrancas(prof))[0].status).toBe('cancelada');
  });
});

describe('renovação da série (D4)', () => {
  it('o período novo começa no dia seguinte, dura o mesmo e respeita os 60 dias', () => {
    const base = { dataInicio: '2026-10-27', dataFim: '2026-11-17', frequencia: 'semanal' as const }; // 21 dias
    const p = periodoDaRenovacao(base, 60, d(2026, 11, 10))!;
    expect([iso(p.dataInicio), iso(p.dataFim)]).toEqual(['2026-11-18', '2026-12-09']);
    // Série que acabou há dias: recomeça amanhã.
    const atrasada = periodoDaRenovacao(base, 60, d(2026, 11, 25))!;
    expect(iso(atrasada.dataInicio)).toBe('2026-11-26');
    // O fim nunca passa de hoje + 60.
    const limitada = periodoDaRenovacao({ ...base, dataFim: '2026-12-10' }, 60, d(2026, 11, 10))!;
    expect(iso(limitada.dataFim)).toBe('2027-01-09');
    // Ainda é cedo: a série já cobre quase o prazo todo.
    expect(periodoDaRenovacao({ ...base, dataFim: '2026-12-25' }, 60, d(2026, 10, 20))).toBeNull();
  });

  it('quinzenal mantém o ritmo: se o primeiro dia cai na semana de folga, começa na segunda seguinte', () => {
    const q = { dataInicio: '2026-10-27', dataFim: '2026-11-03', frequencia: 'quinzenal' as const };
    expect(iso(periodoDaRenovacao(q, 60, d(2026, 10, 28))!.dataInicio)).toBe('2026-11-09'); // 04/11 é semana de folga
    const par = { dataInicio: '2026-10-27', dataFim: '2026-11-24', frequencia: 'quinzenal' as const };
    expect(iso(periodoDaRenovacao(par, 60, d(2026, 11, 20))!.dataInicio)).toBe('2026-11-25'); // mesma semana "de aula"
  });

  it('abre o pedido preenchido, só para o dono, uma vez; renovação recusada não trava outra', async () => {
    const { serieId, prof, anf, espacoId } = await aprovada('pacote_mes');
    const quando = instanteLocal(2026, 11, 12, 12);
    const dados = await dadosDaRenovacao(serieId, prof, quando);
    if (!dados.ok) throw new Error(dados.erro);
    expect(dados.pedido).toMatchObject({ diasSemana: [2, 4], frequencia: 'semanal', unidade: 'hora', horaInicio: 9, horaFim: 10, formaPagamento: 'pacote_mes', espacoId });
    expect([iso(dados.pedido.dataInicio), iso(dados.pedido.dataFim)]).toEqual(['2026-11-18', '2026-12-09']);

    expect(await dadosDaRenovacao(serieId, await f.profissional(), quando)).toEqual({ ok: false, erro: 'nao_encontrada' });
    const r = await criarSerie(dados.pedido, ctx, quando, { renovacaoDeId: dados.renovacaoDeId });
    if (!r.ok) throw new Error(r.erro);
    expect((await serieDe(r.serieId)).renovacaoDeId).toBe(serieId);
    expect(await dadosDaRenovacao(serieId, prof, quando)).toEqual({ ok: false, erro: 'ja_renovada' });

    const { recusarSerie } = await import('./serie-aprovacao');
    await recusarSerie(r.serieId, anf, null, {}, quando);
    expect((await dadosDaRenovacao(serieId, prof, quando)).ok).toBe(true); // a recusada não conta
  });

  it('só renova série aprovada', async () => {
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    const s = await criarSerie(pedido(espacoId, prof), ctx, agora);
    if (!s.ok) throw new Error(s.erro);
    expect(await dadosDaRenovacao(s.serieId, prof, agora)).toEqual({ ok: false, erro: 'nao_renovavel' });
  });

  it('avisa por e-mail perto do fim, uma vez só, e não avisa série já renovada nem longe do fim', async () => {
    const { serieId, prof } = await aprovada('por_ocorrencia');
    const registros = async () => (await db.select().from(schema.notificacao).where(eq(schema.notificacao.referenciaId, serieId))).filter((n) => n.tipo === 'serie_renovar');

    await avisarRenovacaoDeSeries(instanteLocal(2026, 11, 8, 12)); // 9 dias para o fim: ainda longe (aviso = 7)
    expect(await registros()).toHaveLength(0);

    const perto = instanteLocal(2026, 11, 12, 12); // 5 dias
    await avisarRenovacaoDeSeries(perto);
    expect(await registros()).toHaveLength(1);
    expect(emails(prof).filter((e) => e[1].includes('perto do fim'))).toHaveLength(1);
    expect(emails(prof)[emails(prof).length - 1][2]).toContain('17/11');
    await avisarRenovacaoDeSeries(perto);
    await avisarRenovacaoDeSeries(instanteLocal(2026, 11, 13, 12));
    expect(emails(prof).filter((e) => e[1].includes('perto do fim'))).toHaveLength(1);

    // Já renovada: não avisa de novo (outra série da mesma pessoa, renovada antes do aviso).
    const { espacoId } = await f.sala();
    const p2 = await f.profissional();
    const a = await criarSerie(pedido(espacoId, p2), ctx, agora);
    if (!a.ok) throw new Error(a.erro);
    const anf2 = await f.anfitriao();
    await aprovarSerie(a.serieId, anf2, {}, agora);
    const dados = await dadosDaRenovacao(a.serieId, p2, perto);
    if (!dados.ok) throw new Error(dados.erro);
    await criarSerie(dados.pedido, ctx, perto, { renovacaoDeId: dados.renovacaoDeId });
    await avisarRenovacaoDeSeries(perto);
    expect((await db.select().from(schema.notificacao).where(eq(schema.notificacao.referenciaId, a.serieId))).filter((n) => n.tipo === 'serie_renovar')).toHaveLength(0);
  });
});
