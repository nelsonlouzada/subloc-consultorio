import * as Sentry from '@sentry/node';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { formatarReais } from '@/lib/dinheiro';
import { partesLocais } from '@/lib/fuso';
import { registrarAuditoria } from '@/modulos/auditoria/auditoria';
import { usarCredito } from '@/modulos/carteira/carteira';
import { prepararPagamentoOnline } from '@/modulos/cobranca/online';
import { emailSerieCobranca } from '@/modulos/comunicacao/modelos';
import { notificar } from '@/modulos/comunicacao/notificar';
import { descreverMomento, descreverPeriodo } from './calendario';
import { EstadoReservaError, pixManual } from './solicitacao';

/** A cobrança de cada data (ou de cada mês, no pacote) sai com esta antecedência. */
export const DIAS_ANTECEDENCIA_COBRANCA = 3;
/** Prazo para pagar uma cobrança gerada pelo worker (limitado a 6 h antes do início, como em D3). */
export const HORAS_PRAZO_COBRANCA_AGENDADA = 48;

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

type Ocorrencia = typeof schema.reserva.$inferSelect;
type Grupo = { finalidade: 'ocorrencia' | 'pacote_mes'; reservas: Ocorrencia[] };

/**
 * Agrupa as ocorrências aprovadas que ainda não têm cobrança:
 * - por ocorrência: uma cobrança por data, gerada `DIAS_ANTECEDENCIA_COBRANCA` dias antes;
 * - pacote do mês: uma cobrança por mês (com todas as datas dele), gerada nessa mesma antecedência
 *   contada da primeira data do mês. Na aprovação, o primeiro mês é cobrado já (`primeiroGrupo`).
 */
function gruposDevidos(forma: 'pacote_mes' | 'por_ocorrencia', reservas: Ocorrencia[], agora: Date, primeiroGrupo: boolean): Grupo[] {
  const limite = agora.getTime() + DIAS_ANTECEDENCIA_COBRANCA * DIA_MS;
  if (forma === 'por_ocorrencia') {
    return reservas.filter((r) => r.inicio.getTime() <= limite).map((r) => ({ finalidade: 'ocorrencia' as const, reservas: [r] }));
  }
  const porMes = new Map<string, Ocorrencia[]>();
  for (const r of reservas) {
    const p = partesLocais(r.inicio);
    const chave = `${p.ano}-${String(p.mes).padStart(2, '0')}`;
    porMes.set(chave, [...(porMes.get(chave) ?? []), r]);
  }
  return [...porMes.values()]
    .map((rs) => ({ finalidade: 'pacote_mes' as const, reservas: rs }))
    .filter((g, i) => (primeiroGrupo && i === 0) || g.reservas[0].inicio.getTime() <= limite);
}

/**
 * Gera as cobranças que já devem existir para uma série aprovada. É segura para rodar de novo e
 * por dois processos ao mesmo tempo: cada ocorrência só entra em uma cobrança (a transição
 * `aprovada` -> `aguardando_pagamento` é condicional, e perder a corrida desfaz tudo).
 * O crédito (D8) abate o total do grupo; se cobre tudo, as ocorrências já saem confirmadas.
 * Devolve quantas cobranças foram criadas.
 */
export async function gerarCobrancasDaSerie(serieId: string, opcoes: { primeiroGrupo?: boolean } = {}, agora = new Date()): Promise<number> {
  const [s] = await db
    .select({
      serie: schema.serie,
      nome: schema.usuario.name,
      email: schema.usuario.email,
      horasPagamento: schema.regraEspaco.prazoPagamentoHoras,
      corteHoras: schema.regraEspaco.corteAntesInicioHoras,
    })
    .from(schema.serie)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.serie.profissionalId))
    .innerJoin(schema.regraEspaco, eq(schema.regraEspaco.espacoId, schema.serie.espacoId))
    .where(eq(schema.serie.id, serieId));
  if (!s || s.serie.status !== 'aprovada') return 0;

  const aprovadas = await db
    .select()
    .from(schema.reserva)
    .where(and(eq(schema.reserva.serieId, serieId), eq(schema.reserva.status, 'aprovada')))
    .orderBy(asc(schema.reserva.inicio));
  const grupos = gruposDevidos(s.serie.formaPagamento, aprovadas, agora, opcoes.primeiroGrupo ?? false);

  let criadas = 0;
  for (const [i, grupo] of grupos.entries()) {
    const primeira = grupo.reservas[0].inicio.getTime();
    // Na aprovação vale o prazo de pagamento da D3; as cobranças agendadas pelo worker têm um prazo mais folgado.
    const horas = opcoes.primeiroGrupo && i === 0 ? s.horasPagamento : HORAS_PRAZO_COBRANCA_AGENDADA;
    const prazo = new Date(Math.min(agora.getTime() + horas * HORA_MS, primeira - s.corteHoras * HORA_MS));
    // Sem tempo hábil para pagar: não cobra; a expiração libera o horário.
    if (prazo.getTime() <= agora.getTime() + 5 * 60_000) continue;
    try {
      await cobrarGrupo(s, grupo, prazo, agora);
      criadas++;
    } catch (e) {
      if (e instanceof EstadoReservaError) continue; // outro processo já cobrou este grupo
      Sentry.captureException(e, { tags: { fluxo: 'serie_cobranca' } });
      throw e;
    }
  }
  return criadas;
}

async function cobrarGrupo(
  s: { serie: typeof schema.serie.$inferSelect; nome: string; email: string },
  grupo: Grupo,
  prazo: Date,
  agora: Date,
) {
  const ids = grupo.reservas.map((r) => r.id);
  const soma = (campo: 'valorCheioCentavos' | 'descontoCentavos' | 'valorCentavos') => grupo.reservas.reduce((t, r) => t + r[campo], 0);
  const total = soma('valorCentavos');
  const abater = grupo.reservas.some((r) => r.usarCredito);

  const { cobrancaId, usado, aPagar } = await db.transaction(async (tx) => {
    const [c] = await tx
      .insert(schema.cobranca)
      .values({
        profissionalId: s.serie.profissionalId,
        finalidade: grupo.finalidade,
        valorBrutoCentavos: soma('valorCheioCentavos'),
        descontoCentavos: soma('descontoCentavos'),
        valorCobradoCentavos: total,
        venceEm: prazo,
      })
      .returning({ id: schema.cobranca.id });
    const usado = abater ? await usarCredito(tx, { profissionalId: s.serie.profissionalId, ate: total, cobrancaId: c.id }, agora) : 0;
    const aPagar = total - usado;
    const pagaComCredito = aPagar === 0;

    const tomadas = await tx
      .update(schema.reserva)
      .set(pagaComCredito ? { status: 'confirmada' } : { status: 'aguardando_pagamento', prazoPagamentoAte: prazo })
      .where(and(inArray(schema.reserva.id, ids), eq(schema.reserva.status, 'aprovada')))
      .returning({ id: schema.reserva.id });
    // Alguma ocorrência já foi cobrada por outro processo: desfaz esta cobrança inteira (inclusive o crédito).
    if (tomadas.length !== ids.length) throw new EstadoReservaError('já cobrada');

    await tx
      .update(schema.cobranca)
      .set({ creditoUsadoCentavos: usado, valorCobradoCentavos: aPagar, ...(pagaComCredito ? { status: 'paga' as const, meio: 'credito' as const, pagoEm: agora } : {}) })
      .where(eq(schema.cobranca.id, c.id));
    await tx.insert(schema.cobrancaItem).values(grupo.reservas.map((r) => ({ cobrancaId: c.id, reservaId: r.id, valorCentavos: r.valorCentavos })));
    return { cobrancaId: c.id, usado, aPagar };
  });

  const periodos = grupo.reservas.map((r) => descreverPeriodo(r.inicio, r.fim));
  await registrarAuditoria({
    usuarioId: null,
    acao: 'cobranca_serie_gerada',
    entidade: 'serie',
    entidadeId: s.serie.id,
    dados: { cobrancaId, ocorrencias: ids.length, finalidade: grupo.finalidade, totalCentavos: total, creditoUsadoCentavos: usado },
  });

  const online = aPagar > 0 ? await prepararPagamentoOnline(cobrancaId, `Série: ${periodos.length === 1 ? periodos[0] : `${periodos.length} datas`}`) : null;
  const m = emailSerieCobranca({
    nome: s.nome,
    periodos,
    valor: formatarReais(aPagar),
    creditoUsado: usado > 0 ? formatarReais(usado) : null,
    prazoPagamento: aPagar > 0 ? descreverMomento(prazo) : null,
    pix: pixManual(),
    online,
    serieId: s.serie.id,
    pacote: grupo.finalidade === 'pacote_mes',
  });
  await notificar({
    usuarioId: s.serie.profissionalId,
    para: s.email,
    tipo: 'serie_cobranca',
    assunto: m.assunto,
    html: m.html,
    referenciaTipo: 'cobranca',
    referenciaId: cobrancaId,
  });
}

/** Gera as cobranças devidas de todas as séries aprovadas (job do worker). Devolve o total criado. */
export async function gerarCobrancasPendentes(agora = new Date()): Promise<number> {
  const series = await db.select({ id: schema.serie.id }).from(schema.serie).where(eq(schema.serie.status, 'aprovada'));
  let total = 0;
  for (const s of series) total += await gerarCobrancasDaSerie(s.id, {}, agora);
  return total;
}
