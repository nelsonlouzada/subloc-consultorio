import { and, count, eq, gt, gte, inArray, lt, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { diaSemanaDe, instanteLocal, partesLocais, somarDias } from '@/lib/fuso';

/**
 * Financeiro (T25). Não há tabela de "lançamentos": os números saem de `cobranca`, `credito_*` e
 * `reserva`, por mês em hora local da sala. Regime de caixa: conta o dinheiro quando ele entra
 * (`pago_em`), não quando a sala é usada. Pagamento feito só com crédito não entra, porque o
 * dinheiro já entrou na compra ou no pagamento original.
 */

export type Mes = { texto: string; ano: number; mes: number; inicio: Date; fim: Date };

/** '2026-10' -> limites do mês em hora local. Texto fora do formato ou mês inexistente devolve null. */
export function lerMes(texto: string | undefined | null): Mes | null {
  const m = /^(\d{4})-(\d{2})$/.exec(texto ?? '');
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  if (ano < 2000 || ano > 2100 || mes < 1 || mes > 12) return null;
  const proximo = mes === 12 ? { ano: ano + 1, mes: 1 } : { ano, mes: mes + 1 };
  return { texto: `${m[1]}-${m[2]}`, ano, mes, inicio: instanteLocal(ano, mes, 1), fim: instanteLocal(proximo.ano, proximo.mes, 1) };
}

export const mesAtual = (agora = new Date()): Mes => {
  const p = partesLocais(agora);
  return lerMes(`${p.ano}-${String(p.mes).padStart(2, '0')}`)!;
};

/** O mês anterior ou seguinte, no formato AAAA-MM, para os botões de navegação. */
export function mesVizinho(m: Mes, delta: -1 | 1): string {
  const total = m.ano * 12 + (m.mes - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export const ROTULO_FINALIDADE: Record<string, string> = {
  reserva: 'Reserva',
  pacote_mes: 'Pacote do mês',
  ocorrencia: 'Data de série',
  compra_credito: 'Compra de crédito',
};
export const ROTULO_MEIO: Record<string, string> = { pix: 'Pix', cartao: 'Cartão', pix_manual: 'Pix (conferido)', credito: 'Crédito' };

export type Lancamento = {
  cobrancaId: string;
  pagoEm: Date;
  profissionalId: string;
  pagador: string;
  cpf: string;
  finalidade: string;
  meio: string | null;
  valorCentavos: number;
  creditoUsadoCentavos: number;
  /** Datas das reservas pagas (para descrever o lançamento) */
  datas: number;
  primeiraData: Date | null;
  reciboNumero: number | null;
};

/** Dinheiro recebido no mês: cobranças pagas com valor, pela data do pagamento. */
export async function lancamentosDoMes(mes: Mes): Promise<Lancamento[]> {
  const linhas = await db
    .select({
      cobrancaId: schema.cobranca.id,
      pagoEm: schema.cobranca.pagoEm,
      profissionalId: schema.cobranca.profissionalId,
      pagador: schema.usuario.name,
      cpf: schema.profissional.cpf,
      finalidade: schema.cobranca.finalidade,
      meio: schema.cobranca.meio,
      valorCentavos: schema.cobranca.valorCobradoCentavos,
      creditoUsadoCentavos: schema.cobranca.creditoUsadoCentavos,
      reciboNumero: schema.recibo.numero,
    })
    .from(schema.cobranca)
    .innerJoin(schema.profissional, eq(schema.profissional.usuarioId, schema.cobranca.profissionalId))
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.profissional.usuarioId))
    .leftJoin(schema.recibo, eq(schema.recibo.cobrancaId, schema.cobranca.id))
    .where(and(eq(schema.cobranca.status, 'paga'), gt(schema.cobranca.valorCobradoCentavos, 0), gte(schema.cobranca.pagoEm, mes.inicio), lt(schema.cobranca.pagoEm, mes.fim)))
    .orderBy(schema.cobranca.pagoEm);
  if (linhas.length === 0) return [];

  const itens = await db
    .select({ cobrancaId: schema.cobrancaItem.cobrancaId, total: count(), primeira: sql<Date | null>`min(${schema.reserva.inicio})` })
    .from(schema.cobrancaItem)
    .leftJoin(schema.reserva, eq(schema.reserva.id, schema.cobrancaItem.reservaId))
    .where(inArray(schema.cobrancaItem.cobrancaId, linhas.map((l) => l.cobrancaId)))
    .groupBy(schema.cobrancaItem.cobrancaId);
  const item = new Map(itens.map((i) => [i.cobrancaId, i]));

  return linhas.map((l) => ({
    ...l,
    pagoEm: l.pagoEm!,
    datas: l.finalidade === 'compra_credito' ? 0 : (item.get(l.cobrancaId)?.total ?? 0),
    primeiraData: item.get(l.cobrancaId)?.primeira ? new Date(item.get(l.cobrancaId)!.primeira!) : null,
  }));
}

export type ExtratoProfissional = { profissionalId: string; nome: string; pagamentos: number; recebidoCentavos: number; creditoUsadoCentavos: number };

export function extratoPorProfissional(lancamentos: Lancamento[]): ExtratoProfissional[] {
  const mapa = new Map<string, ExtratoProfissional>();
  for (const l of lancamentos) {
    const e = mapa.get(l.profissionalId) ?? { profissionalId: l.profissionalId, nome: l.pagador, pagamentos: 0, recebidoCentavos: 0, creditoUsadoCentavos: 0 };
    e.pagamentos += 1;
    e.recebidoCentavos += l.valorCentavos;
    e.creditoUsadoCentavos += l.creditoUsadoCentavos;
    mapa.set(l.profissionalId, e);
  }
  return [...mapa.values()].sort((a, b) => b.recebidoCentavos - a.recebidoCentavos);
}

export type Resumo = {
  recebidoCentavos: number;
  pagamentos: number;
  estornadoCentavos: number;
  creditoUsadoCentavos: number;
  creditoVencidoCentavos: number;
  /** O que a sala deve em uso futuro: saldo dos lotes de crédito ainda válidos. */
  creditoEmAbertoCentavos: number;
  horasReservadas: number;
  horasDeFuncionamento: number;
};

/** Horas em que a sala abre no mês, pelos dias e horários de funcionamento. */
export function horasDeFuncionamentoNoMes(mes: Mes, dias: number[], abre: number, fecha: number): number {
  let horas = 0;
  for (let d = { ano: mes.ano, mes: mes.mes, dia: 1 }; d.mes === mes.mes; d = somarDias(d, 1)) {
    if (dias.includes(diaSemanaDe(d))) horas += fecha - abre;
  }
  return horas;
}

export async function resumoDoMes(mes: Mes, lancamentos: Lancamento[], funcionamento: { dias: number[]; abre: number; fecha: number }, agora = new Date()): Promise<Resumo> {
  const [estornos] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.cobranca.valorCobradoCentavos}), 0)::int` })
    .from(schema.cobranca)
    .where(and(eq(schema.cobranca.status, 'estornada'), gte(schema.cobranca.pagoEm, mes.inicio), lt(schema.cobranca.pagoEm, mes.fim)));

  const movimentos = await db
    .select({ tipo: schema.creditoMovimento.tipo, total: sql<number>`coalesce(sum(${schema.creditoMovimento.valorCentavos}), 0)::int` })
    .from(schema.creditoMovimento)
    .where(and(inArray(schema.creditoMovimento.tipo, ['uso', 'devolucao_uso', 'vencimento']), gte(schema.creditoMovimento.criadoEm, mes.inicio), lt(schema.creditoMovimento.criadoEm, mes.fim)))
    .groupBy(schema.creditoMovimento.tipo);
  const soma = (tipo: string) => movimentos.find((m) => m.tipo === tipo)?.total ?? 0;

  const [aberto] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.creditoLote.saldoCentavos}), 0)::int` })
    .from(schema.creditoLote)
    .where(and(gt(schema.creditoLote.saldoCentavos, 0), gt(schema.creditoLote.validadeAte, agora)));

  const [horas] = await db
    .select({ total: sql<number>`coalesce(sum(extract(epoch from (${schema.reserva.fim} - ${schema.reserva.inicio})) / 3600), 0)::float` })
    .from(schema.reserva)
    .where(and(inArray(schema.reserva.status, ['confirmada', 'realizada']), gte(schema.reserva.inicio, mes.inicio), lt(schema.reserva.inicio, mes.fim)));

  return {
    recebidoCentavos: lancamentos.reduce((t, l) => t + l.valorCentavos, 0),
    pagamentos: lancamentos.length,
    estornadoCentavos: estornos.total,
    // "uso" é negativo; devolução de uso (cancelamento antes de pagar) é positiva e abate.
    creditoUsadoCentavos: Math.max(0, -(soma('uso') + soma('devolucao_uso'))),
    creditoVencidoCentavos: Math.max(0, -soma('vencimento')),
    creditoEmAbertoCentavos: aberto.total,
    horasReservadas: Math.round(horas.total * 10) / 10,
    horasDeFuncionamento: horasDeFuncionamentoNoMes(mes, funcionamento.dias, funcionamento.abre, funcionamento.fecha),
  };
}

// ---------------------------------------------------------------------------
// Exportação para o carnê-leão
// ---------------------------------------------------------------------------

/** Texto da planilha: nunca começa com caractere que o Excel leria como fórmula (nomes vêm do cadastro). */
function celula(valor: string | number): string {
  let t = String(valor);
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

const BOM = String.fromCharCode(0xfeff);
const reais = (c: number) => (c / 100).toFixed(2).replace('.', ',');
const dataBR = (d: Date) => {
  const p = partesLocais(d);
  return `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')}/${p.ano}`;
};
export const formatarCpf = (cpf: string) => cpf.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');

export function descreverLancamento(l: Pick<Lancamento, 'finalidade' | 'datas' | 'primeiraData'>): string {
  const base = ROTULO_FINALIDADE[l.finalidade] ?? l.finalidade;
  if (l.finalidade === 'compra_credito') return `${base} (uso futuro)`;
  if (!l.datas) return base;
  const quando = l.primeiraData ? ` a partir de ${dataBR(l.primeiraData)}` : '';
  return `${base}: ${l.datas} ${l.datas === 1 ? 'data' : 'datas'}${quando}`;
}

/**
 * CSV do mês para o carnê-leão: uma linha por recebimento, com data, pagador, CPF e valor, mais o
 * total. Separador ponto e vírgula, vírgula decimal e BOM, para abrir direto no Excel em português.
 * Regime de caixa: o crédito comprado entra no mês em que foi pago, não no mês em que é usado
 * (ponto a confirmar com o contador).
 */
export function gerarCsvCarneLeao(lancamentos: Lancamento[]): string {
  const cab = ['Data do recebimento', 'Nome do pagador', 'CPF do pagador', 'Descrição', 'Meio', 'Valor (R$)', 'Recibo nº'];
  const linhas = lancamentos.map((l) => [dataBR(l.pagoEm), l.pagador, formatarCpf(l.cpf), descreverLancamento(l), ROTULO_MEIO[l.meio ?? ''] ?? '', reais(l.valorCentavos), l.reciboNumero ?? ''].map(celula).join(';'));
  const total = lancamentos.reduce((t, l) => t + l.valorCentavos, 0);
  linhas.push(['TOTAL', '', '', '', '', reais(total), ''].join(';'));
  return `${BOM}${[cab.map(celula).join(';'), ...linhas].join('\r\n')}\r\n`;
}
