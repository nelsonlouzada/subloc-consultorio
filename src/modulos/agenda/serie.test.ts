import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool, schema } from '@/db';

const enviarEmail = vi.fn<(para: string, assunto: string, html: string) => Promise<void>>();
vi.mock('@/lib/email', () => ({ enviarEmail: (...a: [string, string, string]) => enviarEmail(...a) }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

import { type DataLocal, formatarDataISO, instanteLocal } from '@/lib/fuso';
import { garantirDocumentosIniciais } from '@/modulos/configuracao/documentos-iniciais';
import { fabrica } from '@/test/fabrica';
import { contarPedidosAbertos, criarReserva } from './reserva';
import { avaliarSerie, criarSerie, descreverSerie, expandirDatas, type PedidoSerie } from './serie';

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
  diasSemana: [2, 4], // terça e quinta
  frequencia: 'semanal',
  unidade: 'hora',
  horaInicio: 9,
  horaFim: 10,
  dataInicio: d(2026, 10, 27), // terça
  dataFim: d(2026, 11, 17), // terça, 21 dias depois
  formaPagamento: 'por_ocorrencia',
  ...extra,
});
const reservasDaSerie = (id: string) => db.select().from(schema.reserva).where(eq(schema.reserva.serieId, id)).orderBy(schema.reserva.inicio);

describe('expandirDatas', () => {
  it('semanal: todos os dias pedidos do período, na ordem, com as pontas incluídas', () => {
    const datas = expandirDatas(d(2026, 10, 27), d(2026, 11, 17), [2, 4], 'semanal').map(iso);
    expect(datas).toEqual(['2026-10-27', '2026-10-29', '2026-11-03', '2026-11-05', '2026-11-10', '2026-11-12', '2026-11-17']);
  });

  it('quinzenal: uma semana sim, outra não, contando da semana da data inicial', () => {
    expect(expandirDatas(d(2026, 10, 27), d(2026, 11, 24), [2], 'quinzenal').map(iso)).toEqual(['2026-10-27', '2026-11-10', '2026-11-24']);
    // Começando numa quinta, a primeira quinzena é a da semana dela: a terça dessa semana já passou e não entra.
    expect(expandirDatas(d(2026, 10, 29), d(2026, 11, 24), [2, 4], 'quinzenal').map(iso)).toEqual(['2026-10-29', '2026-11-10', '2026-11-12', '2026-11-24']);
  });

  it('período vazio ou ao contrário não gera datas', () => {
    expect(expandirDatas(d(2026, 11, 17), d(2026, 10, 27), [2, 4], 'semanal')).toEqual([]);
    expect(expandirDatas(d(2026, 10, 27), d(2026, 10, 28), [5], 'semanal')).toEqual([]);
  });
});

describe('descreverSerie', () => {
  it('escreve a série em português', () => {
    const base = { horaInicio: 9, horaFim: 10, dataInicio: '2026-10-27', dataFim: '2026-11-17' };
    expect(descreverSerie({ ...base, diasSemana: [4, 2], frequencia: 'semanal' })).toBe('toda terça e quinta, 09:00 às 10:00, de 27/10 a 17/11');
    expect(descreverSerie({ ...base, diasSemana: [2], frequencia: 'quinzenal' })).toBe('a cada duas semanas, terça, 09:00 às 10:00, de 27/10 a 17/11');
  });
});

describe('pedido de série', () => {
  it('cria uma reserva solicitada por data, todas retendo o horário, com um prazo único e um aceite', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const r = await criarSerie(pedido(espacoId, prof), ctx, agora);
    if (!r.ok) throw new Error(r.erro);

    expect(r).toMatchObject({ ocorrencias: 7, totalCentavos: 7 * 5000 });
    expect(r.ignoradas).toEqual([]);
    const reservas = await reservasDaSerie(r.serieId);
    expect(reservas).toHaveLength(7);
    expect(reservas.every((x) => x.status === 'solicitada' && x.valorCentavos === 5000 && x.descontoCentavos === 0 && x.usarCredito)).toBe(true);
    expect(new Set(reservas.map((x) => x.prazoAprovacaoAte!.getTime())).size).toBe(1);
    // 12h depois do pedido (a primeira data está longe, então o prazo é o de 12h).
    expect(reservas[0].prazoAprovacaoAte!.getTime()).toBe(agora.getTime() + 12 * 3_600_000);
    const ocupacoes = await db.select().from(schema.ocupacao).where(eq(schema.ocupacao.espacoId, espacoId));
    expect(ocupacoes).toHaveLength(7);
    const [serie] = await db.select().from(schema.serie).where(eq(schema.serie.id, r.serieId));
    expect(serie).toMatchObject({ status: 'solicitada', frequencia: 'semanal', formaPagamento: 'por_ocorrencia', horaInicio: 9, horaFim: 10, dataInicio: '2026-10-27', dataFim: '2026-11-17' });
    expect(serie.diasSemana).toEqual([2, 4]);
    const aceites = await db.select().from(schema.aceite).where(eq(schema.aceite.serieId, r.serieId));
    expect(aceites).toHaveLength(1);
    expect(aceites[0]).toMatchObject({ usuarioId: prof, ip: '203.0.113.5' });
    expect(enviarEmail.mock.calls.some((c) => c[0] === `${anf}@example.com` && c[1].includes('Nova solicitação de série'))).toBe(true);
  });

  it('pacote do mês aplica o desconto da sala em cada data; por ocorrência não desconta', async () => {
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    const r = await criarSerie(pedido(espacoId, prof, { formaPagamento: 'pacote_mes' }), ctx, agora);
    if (!r.ok) throw new Error(r.erro);
    const reservas = await reservasDaSerie(r.serieId);
    expect(reservas.every((x) => x.valorCheioCentavos === 5000 && x.descontoCentavos === 500 && x.valorCentavos === 4500)).toBe(true);
    expect(r.totalCentavos).toBe(7 * 4500);
  });

  it('turno e dia inteiro usam o preço do turno e do dia', async () => {
    const { espacoId, turno1 } = await f.sala();
    const prof = await f.profissional();
    const turno = await avaliarSerie(pedido(espacoId, prof, { unidade: 'turno', turnoId: turno1, horaInicio: null, horaFim: null }), agora);
    if (!turno.ok) throw new Error(turno.erro);
    expect(turno.avaliada.horario).toMatchObject({ de: 7, ate: 12 });
    expect(turno.avaliada.validas[0].valorCentavos).toBe(20000);
    const dia = await avaliarSerie(pedido(espacoId, prof, { unidade: 'dia', horaInicio: null, horaFim: null, diasSemana: [2], dataFim: d(2026, 11, 3) }), agora);
    if (!dia.ok) throw new Error(dia.erro);
    expect(dia.avaliada.validas).toHaveLength(2);
    expect(dia.avaliada.validas[0].valorCentavos).toBe(45000);
  });

  it('datas indisponíveis ficam de fora, com o motivo, e as demais entram', async () => {
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    const outra = await f.profissional();
    // Outra pessoa já pediu a quinta, 29/10, às 9h.
    const ocupada = await criarReserva({ espacoId, profissionalId: outra, inicio: instanteLocal(2026, 10, 29, 9), fim: instanteLocal(2026, 10, 29, 10), unidade: 'hora' }, ctx, agora);
    expect(ocupada.ok).toBe(true);

    const r = await criarSerie(pedido(espacoId, prof), ctx, agora);
    if (!r.ok) throw new Error(r.erro);
    expect(r.ocorrencias).toBe(6);
    expect(r.ignoradas.map((o) => [iso(o.data), o.motivo])).toEqual([['2026-10-29', 'ocupado']]);
    expect((await reservasDaSerie(r.serieId)).map((x) => x.inicio.getTime())).not.toContain(instanteLocal(2026, 10, 29, 9).getTime());
  });

  it('a trava de 1 hora de outra pessoa também deixa a data de fora', async () => {
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    const outra = await f.profissional();
    // 10h-11h de outra pessoa: a série das 9h-10h bate na trava (precisa de 1h de intervalo).
    await criarReserva({ espacoId, profissionalId: outra, inicio: instanteLocal(2026, 11, 3, 10), fim: instanteLocal(2026, 11, 3, 11), unidade: 'hora' }, ctx, agora);
    const r = await criarSerie(pedido(espacoId, prof), ctx, agora);
    if (!r.ok) throw new Error(r.erro);
    expect(r.ignoradas.map((o) => [iso(o.data), o.motivo])).toEqual([['2026-11-03', 'trava']]);
  });

  it('a série inteira conta como UM pedido em aberto', async () => {
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    const r = await criarSerie(pedido(espacoId, prof), ctx, agora);
    expect(r.ok).toBe(true);
    expect(await contarPedidosAbertos(prof, agora)).toBe(1);
  });

  it('com 5 pedidos em aberto, uma série nova é recusada', async () => {
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    for (let i = 0; i < 5; i++) {
      const r = await criarReserva({ espacoId, profissionalId: prof, inicio: instanteLocal(2026, 11, 2 + i, 18), fim: instanteLocal(2026, 11, 2 + i, 19), unidade: 'hora' }, ctx, agora);
      expect(r.ok).toBe(true);
    }
    expect(await criarSerie(pedido(espacoId, prof), ctx, agora)).toEqual({ ok: false, erro: 'limite_pedidos' });
  });

  it('recusa período, dias e horário inválidos, sem gravar nada', async () => {
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    const erro = async (extra: Partial<PedidoSerie>) => {
      const r = await criarSerie(pedido(espacoId, prof, extra), ctx, agora);
      return r.ok ? 'ok' : r.erro;
    };
    expect(await erro({ diasSemana: [] })).toBe('dias_invalidos');
    expect(await erro({ diasSemana: [0, 9] })).toBe('dias_invalidos');
    expect(await erro({ dataFim: d(2026, 10, 20) })).toBe('periodo_invalido'); // fim antes do início
    expect(await erro({ dataInicio: d(2026, 10, 13), dataFim: d(2026, 11, 3) })).toBe('periodo_invalido'); // início no passado
    expect(await erro({ dataFim: d(2027, 1, 30) })).toBe('periodo_longe'); // além de 60 dias (D4)
    expect(await erro({ unidade: 'turno', turnoId: null })).toBe('unidade_invalida');
    expect(await erro({ unidade: 'turno', turnoId: '00000000-0000-0000-0000-000000000000' })).toBe('unidade_invalida');
    expect(await erro({ horaInicio: 10, horaFim: 9 })).toBe('unidade_invalida');
    expect(await erro({ horaInicio: 9, horaFim: 30 })).toBe('unidade_invalida');
    expect(await erro({ diasSemana: [1, 2, 3, 4, 5, 6], dataFim: d(2026, 12, 15) })).toBe('muitas_ocorrencias');
    expect(await erro({ diasSemana: [7], dataFim: d(2026, 11, 1) })).toBe('sem_ocorrencias_validas'); // a sala fecha aos domingos
    expect(await db.select().from(schema.serie).where(eq(schema.serie.profissionalId, prof))).toHaveLength(0);
  });

  it('cadastro recusado ou bloqueado não pede série', async () => {
    const { espacoId } = await f.sala();
    const recusado = await f.profissional('recusado');
    expect(await criarSerie(pedido(espacoId, recusado), ctx, agora)).toEqual({ ok: false, erro: 'profissional_nao_pode' });
  });

  it('dois pedidos iguais ao mesmo tempo: só um é gravado, e o outro não deixa nada para trás', async () => {
    const { espacoId } = await f.sala();
    const a = await f.profissional();
    const b = await f.profissional();
    const [ra, rb] = await Promise.all([criarSerie(pedido(espacoId, a), ctx, agora), criarSerie(pedido(espacoId, b), ctx, agora)]);
    const oks = [ra, rb].filter((r) => r.ok);
    // Os dois avaliam antes de gravar; quem perde a corrida é recusado pelo banco (ou entra com as datas que sobraram).
    expect(oks.length).toBeGreaterThanOrEqual(1);
    const ocupacoes = await db.select().from(schema.ocupacao).where(eq(schema.ocupacao.espacoId, espacoId));
    const reservas = await db.select().from(schema.reserva).where(eq(schema.reserva.espacoId, espacoId));
    expect(ocupacoes).toHaveLength(reservas.length); // nunca uma reserva sem horário retido, nem o contrário
    const porHorario = new Set(ocupacoes.map((o) => o.periodo));
    expect(porHorario.size).toBe(ocupacoes.length); // nenhum horário em dobro
    // Quem perde a corrida é recusado pelo banco ('ocupado') ou já enxerga as datas tomadas ('sem_ocorrencias_validas').
    const perdedor = [ra, rb].find((r) => !r.ok);
    if (perdedor && !perdedor.ok) expect(['ocupado', 'sem_ocorrencias_validas']).toContain(perdedor.erro);
  });
});
