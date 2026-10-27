import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool, schema } from '@/db';
import { instanteLocal } from '@/lib/fuso';
import { fabrica } from '@/test/fabrica';
import {
  descreverLancamento,
  extratoPorProfissional,
  gerarCsvCarneLeao,
  horasDeFuncionamentoNoMes,
  lancamentosDoMes,
  lerMes,
  mesVizinho,
  resumoDoMes,
} from './relatorio';

const f = fabrica();
afterAll(async () => {
  await f.limpar();
  await pool.end();
});

// Um ano que nenhum outro teste usa, para a soma do mês ser só a daqui.
const MARCO = lerMes('2031-03')!;
const ABRIL = lerMes('2031-04')!;
const funcionamento = { dias: [1, 2, 3, 4, 5, 6], abre: 7, fecha: 22 };

async function cobranca(prof: string, extra: Partial<typeof schema.cobranca.$inferInsert> = {}) {
  const [c] = await db
    .insert(schema.cobranca)
    .values({ profissionalId: prof, finalidade: 'reserva', valorBrutoCentavos: 15000, valorCobradoCentavos: 15000, status: 'paga', meio: 'pix_manual', pagoEm: instanteLocal(2031, 3, 10, 12), ...extra })
      .returning();
  return c;
}

describe('mês', () => {
  it('lê AAAA-MM e devolve os limites em hora local', () => {
    expect(MARCO.inicio).toEqual(instanteLocal(2031, 3, 1));
    expect(MARCO.fim).toEqual(instanteLocal(2031, 4, 1));
    expect(lerMes('2031-12')!.fim).toEqual(instanteLocal(2032, 1, 1));
  });

  it.each([undefined, '', '2031-13', '2031-00', '1999-05', '2101-01', '2031-3', 'abc', '2031-03-01'])('recusa %j', (t) => {
    expect(lerMes(t)).toBeNull();
  });

  it('navega entre meses, inclusive na virada do ano', () => {
    expect(mesVizinho(MARCO, -1)).toBe('2031-02');
    expect(mesVizinho(MARCO, 1)).toBe('2031-04');
    expect(mesVizinho(lerMes('2031-01')!, -1)).toBe('2030-12');
    expect(mesVizinho(lerMes('2031-12')!, 1)).toBe('2032-01');
  });

  it('conta as horas de funcionamento do mês pelos dias abertos', () => {
    // março de 2031 tem 31 dias e 5 domingos (2, 9, 16, 23, 30): 26 dias abertos x 15 h
    expect(horasDeFuncionamentoNoMes(MARCO, [1, 2, 3, 4, 5, 6], 7, 22)).toBe(26 * 15);
    expect(horasDeFuncionamentoNoMes(MARCO, [], 7, 22)).toBe(0);
  });
});

describe('lançamentos do mês', () => {
  it('conta só dinheiro recebido no mês, pela data local do pagamento, e agrupa por profissional', async () => {
    const prof = await f.profissional();
    const outra = await f.profissional();

    const dentro = await cobranca(prof);
    await cobranca(prof, { finalidade: 'compra_credito', valorBrutoCentavos: 10000, valorCobradoCentavos: 10000, pagoEm: instanteLocal(2031, 3, 31, 23, 30) }); // 02h30 UTC de abril, mas ainda é março aqui
    await cobranca(outra, { valorBrutoCentavos: 5000, valorCobradoCentavos: 5000, meio: 'pix', pagoEm: instanteLocal(2031, 3, 1, 0, 0) }); // primeiro instante do mês
    // fora do mês ou sem dinheiro novo:
    await cobranca(prof, { pagoEm: instanteLocal(2031, 4, 1, 0, 0) });
    await cobranca(prof, { pagoEm: instanteLocal(2031, 2, 28, 23, 59) });
    await cobranca(prof, { valorCobradoCentavos: 0, creditoUsadoCentavos: 15000, meio: 'credito' });
    await cobranca(prof, { status: 'pendente', pagoEm: null });
    await cobranca(prof, { status: 'cancelada', pagoEm: null });

    const lista = await lancamentosDoMes(MARCO);
    expect(lista.map((l) => l.valorCentavos)).toEqual([5000, 15000, 10000]); // em ordem de data
    expect(lista[1]).toMatchObject({ cobrancaId: dentro.id, profissionalId: prof, meio: 'pix_manual', reciboNumero: null });
    expect(lista[1].cpf).toMatch(/^\d{11}$|^\d+$/);

    const extrato = extratoPorProfissional(lista);
    expect(extrato.map((e) => [e.profissionalId, e.pagamentos, e.recebidoCentavos])).toEqual([
      [prof, 2, 25000],
      [outra, 1, 5000],
    ]);

    expect((await lancamentosDoMes(ABRIL)).map((l) => l.valorCentavos)).toEqual([15000]);
  });

  it('descreve o lançamento, com as datas da reserva paga', async () => {
    const prof = await f.profissional();
    const { espacoId } = await f.sala();
    const [r] = await db
      .insert(schema.reserva)
      .values({ espacoId, profissionalId: prof, inicio: instanteLocal(2031, 5, 6, 9), fim: instanteLocal(2031, 5, 6, 10), unidade: 'hora', valorCheioCentavos: 5000, valorCentavos: 5000, status: 'confirmada' })
      .returning();
    const c = await cobranca(prof, { pagoEm: instanteLocal(2031, 5, 2, 10) });
    await db.insert(schema.cobrancaItem).values({ cobrancaId: c.id, reservaId: r.id, valorCentavos: 5000 });

    const [l] = (await lancamentosDoMes(lerMes('2031-05')!)).filter((x) => x.cobrancaId === c.id);
    expect(l).toMatchObject({ datas: 1 });
    expect(descreverLancamento(l)).toBe('Reserva: 1 data a partir de 06/05/2031');
    expect(descreverLancamento({ finalidade: 'compra_credito', datas: 0, primeiraData: null })).toBe('Compra de crédito (uso futuro)');
    expect(descreverLancamento({ finalidade: 'pacote_mes', datas: 4, primeiraData: null })).toBe('Pacote do mês: 4 datas');
  });
});

describe('resumo do mês', () => {
  it('soma o recebido, o crédito usado e vencido, o estorno e as horas reservadas', async () => {
    const prof = await f.profissional();
    const { espacoId } = await f.sala();
    const mes = lerMes('2031-07')!;
    await cobranca(prof, { pagoEm: instanteLocal(2031, 7, 3, 9), valorCobradoCentavos: 12000, valorBrutoCentavos: 12000 });
    await cobranca(prof, { status: 'estornada', pagoEm: instanteLocal(2031, 7, 4, 9), valorCobradoCentavos: 3000, valorBrutoCentavos: 3000 });
    const [lote] = await db
      .insert(schema.creditoLote)
      .values({ profissionalId: prof, origem: 'ajuste_manual', valorInicialCentavos: 9000, saldoCentavos: 9000, validadeAte: new Date(Date.now() + 30 * 86_400_000) })
      .returning();
    await db.insert(schema.creditoMovimento).values([
      { loteId: lote.id, tipo: 'uso', valorCentavos: -4000, criadoEm: instanteLocal(2031, 7, 5, 9) },
      { loteId: lote.id, tipo: 'devolucao_uso', valorCentavos: 1000, criadoEm: instanteLocal(2031, 7, 6, 9) },
      { loteId: lote.id, tipo: 'vencimento', valorCentavos: -2000, criadoEm: instanteLocal(2031, 7, 7, 9) },
      { loteId: lote.id, tipo: 'uso', valorCentavos: -999, criadoEm: instanteLocal(2031, 8, 1, 0) }, // outro mês
    ]);
    await db.insert(schema.reserva).values([
      { espacoId, profissionalId: prof, inicio: instanteLocal(2031, 7, 8, 9), fim: instanteLocal(2031, 7, 8, 12), unidade: 'hora', valorCheioCentavos: 100, valorCentavos: 100, status: 'confirmada' },
      { espacoId, profissionalId: prof, inicio: instanteLocal(2031, 7, 9, 9), fim: instanteLocal(2031, 7, 9, 10, 30), unidade: 'hora', valorCheioCentavos: 100, valorCentavos: 100, status: 'realizada' },
      { espacoId, profissionalId: prof, inicio: instanteLocal(2031, 7, 10, 9), fim: instanteLocal(2031, 7, 10, 12), unidade: 'hora', valorCheioCentavos: 100, valorCentavos: 100, status: 'cancelada' },
    ]);

    const lista = await lancamentosDoMes(mes);
    const r = await resumoDoMes(mes, lista, funcionamento);
    expect(r).toMatchObject({
      recebidoCentavos: 12000,
      pagamentos: 1,
      estornadoCentavos: 3000,
      creditoUsadoCentavos: 3000, // 4000 usados menos 1000 devolvidos
      creditoVencidoCentavos: 2000,
      horasReservadas: 4.5,
    });
    expect(r.creditoEmAbertoCentavos).toBeGreaterThanOrEqual(9000);
    expect(r.horasDeFuncionamento).toBe(horasDeFuncionamentoNoMes(mes, funcionamento.dias, 7, 22));
  });
});

describe('CSV do carnê-leão', () => {
  it('traz data, pagador, CPF, descrição, meio, valor e recibo, com total, em formato aberto pelo Excel', async () => {
    const prof = await f.profissional();
    await db.update(schema.usuario).set({ name: 'Ana "Lu" Souza; Silva' }).where(eq(schema.usuario.id, prof));
    await db.update(schema.profissional).set({ cpf: '52998224725' }).where(eq(schema.profissional.usuarioId, prof));
    await cobranca(prof, { pagoEm: instanteLocal(2031, 9, 5, 14), valorCobradoCentavos: 15050, valorBrutoCentavos: 15050 });
    const lista = await lancamentosDoMes(lerMes('2031-09')!);

    const csv = gerarCsvCarneLeao(lista);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const linhas = csv.slice(1).split('\r\n');
    expect(linhas[0]).toBe('Data do recebimento;Nome do pagador;CPF do pagador;Descrição;Meio;Valor (R$);Recibo nº');
    expect(linhas[1]).toBe('05/09/2031;"Ana ""Lu"" Souza; Silva";529.982.247-25;Reserva;Pix (conferido);150,50;');
    expect(linhas[2]).toBe('TOTAL;;;;;150,50;');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('neutraliza nomes que o Excel leria como fórmula', async () => {
    const prof = await f.profissional();
    await db.update(schema.usuario).set({ name: '=HYPERLINK("http://x")' }).where(eq(schema.usuario.id, prof));
    await cobranca(prof, { pagoEm: instanteLocal(2031, 10, 5, 14) });
    const csv = gerarCsvCarneLeao(await lancamentosDoMes(lerMes('2031-10')!));
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).not.toMatch(/;=HYPERLINK/);
  });

  it('mês sem recebimentos gera só o cabeçalho e o total zerado', () => {
    expect(gerarCsvCarneLeao([]).slice(1).split('\r\n').slice(1, 2)).toEqual(['TOTAL;;;;;0,00;']);
  });
});
