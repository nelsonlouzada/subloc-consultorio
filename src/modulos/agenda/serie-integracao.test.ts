import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool, schema } from '@/db';

const enviarEmail = vi.fn<(para: string, assunto: string, html: string) => Promise<void>>();
vi.mock('@/lib/email', () => ({ enviarEmail: (...a: [string, string, string]) => enviarEmail(...a) }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

import { type DataLocal, instanteLocal } from '@/lib/fuso';
import { garantirDocumentosIniciais } from '@/modulos/configuracao/documentos-iniciais';
import { fabrica } from '@/test/fabrica';
import { marcarPagoDaReserva } from './marcar-pago';
import { criarReserva } from './reserva';
import { aprovarSerie } from './serie-aprovacao';
import { criarSerie, type PedidoSerie } from './serie';
import { aprovarReserva, contarSolicitacoes, EstadoReservaError, listarSeriesDaFila, listarSolicitacoes, recusarReserva } from './solicitacao';

const f = fabrica();
const ctx = { ip: '203.0.113.5', userAgent: 'vitest' };
const agora = instanteLocal(2026, 10, 20, 12);
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

const pedido = (espacoId: string, profissionalId: string, forma: PedidoSerie['formaPagamento']): PedidoSerie => ({
  espacoId,
  profissionalId,
  diasSemana: [2, 4],
  frequencia: 'semanal',
  unidade: 'hora',
  horaInicio: 9,
  horaFim: 10,
  dataInicio: d(2026, 10, 27),
  dataFim: d(2026, 11, 17),
  formaPagamento: forma,
});
const reservas = (serieId: string) => db.select().from(schema.reserva).where(eq(schema.reserva.serieId, serieId)).orderBy(schema.reserva.inicio);

describe('séries na fila do Anfitrião', () => {
  it('a série entra como UM pedido; as datas não aparecem soltas nem contam como pedidos', async () => {
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    const outra = await f.profissional();
    const s = await criarSerie(pedido(espacoId, prof, 'pacote_mes'), ctx, agora);
    if (!s.ok) throw new Error(s.erro);
    const avulsa = await criarReserva({ espacoId, profissionalId: outra, inicio: instanteLocal(2026, 11, 20, 14), fim: instanteLocal(2026, 11, 20, 15), unidade: 'hora' }, ctx, agora);
    expect(avulsa.ok).toBe(true);

    expect((await listarSolicitacoes(espacoId)).map((x) => x.profissionalId)).toEqual([outra]); // só a avulsa
    expect(await contarSolicitacoes(espacoId)).toBe(2); // a série (1) + a avulsa (1)
    const fila = await listarSeriesDaFila(espacoId);
    expect(fila.paraAprovar).toHaveLength(1);
    expect(fila.paraAprovar[0]).toMatchObject({ id: s.serieId, profissionalNome: expect.any(String), ocorrencias: 7, valorCentavos: 7 * 4500, formaPagamento: 'pacote_mes' });
    expect(fila.paraAprovar[0].prazoAprovacaoAte!.getTime()).toBe(agora.getTime() + 12 * 3_600_000);
    expect(fila.aguardandoPagamento).toHaveLength(0);
  });

  it('depois de aprovada, a série com pagamento em aberto passa para "aguardando pagamento"', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const s = await criarSerie(pedido(espacoId, prof, 'pacote_mes'), ctx, agora);
    if (!s.ok) throw new Error(s.erro);
    await aprovarSerie(s.serieId, anf, {}, agora);

    const fila = await listarSeriesDaFila(espacoId);
    expect(fila.paraAprovar).toHaveLength(0);
    expect(fila.aguardandoPagamento).toHaveLength(1);
    expect(fila.aguardandoPagamento[0]).toMatchObject({ id: s.serieId, ocorrencias: 2, valorCentavos: 9000 });
    expect(fila.aguardandoPagamento[0].prazoPagamentoAte!.getTime()).toBe(agora.getTime() + 2 * 3_600_000);
    expect(await contarSolicitacoes(espacoId)).toBe(0);
  });

  it('uma data solta de série não pode ser aprovada nem recusada à parte', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const s = await criarSerie(pedido(espacoId, prof, 'por_ocorrencia'), ctx, agora);
    if (!s.ok) throw new Error(s.erro);
    const [primeira] = await reservas(s.serieId);
    await expect(aprovarReserva(primeira.id, anf, {}, agora)).rejects.toThrow(EstadoReservaError);
    await expect(recusarReserva(primeira.id, anf, null)).rejects.toThrow(EstadoReservaError);
    expect((await reservas(s.serieId)).map((r) => r.status)).toEqual(Array(7).fill('solicitada'));
  });
});

describe('marcar pagamento a partir de uma data de série', () => {
  it('vale para a cobrança inteira (o pacote do mês), não só para a data aberta', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const s = await criarSerie(pedido(espacoId, prof, 'pacote_mes'), ctx, agora);
    if (!s.ok) throw new Error(s.erro);
    await aprovarSerie(s.serieId, anf, {}, agora);
    const [primeira] = await reservas(s.serieId);

    expect(await marcarPagoDaReserva(primeira.id, anf, {}, agora)).toEqual({ reativada: false, creditoCentavos: 0 });
    expect((await reservas(s.serieId)).slice(0, 3).map((r) => r.status)).toEqual(['confirmada', 'confirmada', 'aprovada']);
    const [c] = await db.select().from(schema.cobranca).where(eq(schema.cobranca.profissionalId, prof));
    expect(c).toMatchObject({ status: 'paga', meio: 'pix_manual' });
  });

  it('reserva avulsa continua pela regra de sempre', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const r = await criarReserva({ espacoId, profissionalId: prof, inicio: instanteLocal(2026, 11, 3, 9), fim: instanteLocal(2026, 11, 3, 10), unidade: 'hora' }, ctx, agora);
    if (!r.ok) throw new Error(r.erro);
    await aprovarReserva(r.reservaId, anf, {}, agora);
    expect(await marcarPagoDaReserva(r.reservaId, anf, {}, agora)).toEqual({ reativada: false, creditoCentavos: 0 });
    const [res] = await db.select().from(schema.reserva).where(eq(schema.reserva.id, r.reservaId));
    expect(res.status).toBe('confirmada');
  });
});
