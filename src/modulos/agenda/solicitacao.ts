import { and, count, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { registrarAuditoria } from '@/modulos/auditoria/auditoria';
import { emailPagamentoConfirmado, emailReservaAprovada, emailReservaRecusada } from '@/modulos/comunicacao/modelos';
import { usarCredito } from '@/modulos/carteira/carteira';
import { prepararPagamentoOnline } from '@/modulos/cobranca/online';
import { notificar } from '@/modulos/comunicacao/notificar';
import { aprovarProfissional, TransicaoInvalidaError } from '@/modulos/identidade/aprovacao';
import { formatarReais } from '@/lib/dinheiro';
import { descreverMomento, descreverPeriodo } from './calendario';

const HORA_MS = 3_600_000;

export class ReservaNaoEncontradaError extends Error {
  constructor() {
    super('Reserva não encontrada.');
    this.name = 'ReservaNaoEncontradaError';
  }
}

/** A reserva não está mais no estado esperado (já foi decidida, expirou ou foi cancelada). */
export class EstadoReservaError extends Error {
  constructor(public readonly status: string) {
    super(`A reserva está "${status}" e não pode mais ser decidida.`);
    this.name = 'EstadoReservaError';
  }
}

/** O prazo para aprovar já passou: o horário será liberado pelo sistema. */
export class PrazoVencidoError extends Error {
  constructor() {
    super('O prazo para aprovar este pedido já passou.');
    this.name = 'PrazoVencidoError';
  }
}

/** O cadastro do Profissional ainda está pendente: aprovar o pedido exige aprovar o cadastro junto. */
export class CadastroPendenteError extends Error {
  constructor() {
    super('O cadastro deste profissional ainda não foi aprovado.');
    this.name = 'CadastroPendenteError';
  }
}

export const pixManual = () => {
  const chave = process.env.PIX_MANUAL_CHAVE?.trim();
  const beneficiario = process.env.PIX_MANUAL_NOME?.trim();
  return chave && beneficiario ? { chave, beneficiario } : null;
};

/** Pedidos esperando decisão e pedidos aprovados esperando pagamento, para a tela do Anfitrião. */
export async function listarSolicitacoes(espacoId: string) {
  const linhas = await db
    .select({
      id: schema.reserva.id,
      status: schema.reserva.status,
      unidade: schema.reserva.unidade,
      inicio: schema.reserva.inicio,
      fim: schema.reserva.fim,
      valorCentavos: schema.reserva.valorCentavos,
      prazoAprovacaoAte: schema.reserva.prazoAprovacaoAte,
      prazoPagamentoAte: schema.reserva.prazoPagamentoAte,
      criadoEm: schema.reserva.criadoEm,
      profissionalId: schema.profissional.usuarioId,
      profissionalNome: schema.usuario.name,
      profissionalStatus: schema.profissional.status,
      conselho: schema.profissional.conselho,
      registro: schema.profissional.registroNumero,
      uf: schema.profissional.registroUf,
    })
    .from(schema.reserva)
    .innerJoin(schema.profissional, eq(schema.profissional.usuarioId, schema.reserva.profissionalId))
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.profissional.usuarioId))
    .where(and(eq(schema.reserva.espacoId, espacoId), inArray(schema.reserva.status, ['solicitada', 'aguardando_pagamento'])))
    .orderBy(schema.reserva.inicio);

  // Histórico de cada Profissional: reservas realizadas e faltas (A4).
  const ids = [...new Set(linhas.map((l) => l.profissionalId))];
  const historico = ids.length
    ? await db
        .select({ profissionalId: schema.reserva.profissionalId, status: schema.reserva.status, total: count() })
        .from(schema.reserva)
        .where(and(inArray(schema.reserva.profissionalId, ids), inArray(schema.reserva.status, ['realizada', 'falta'])))
        .groupBy(schema.reserva.profissionalId, schema.reserva.status)
    : [];
  const de = (id: string, s: string) => historico.find((h) => h.profissionalId === id && h.status === s)?.total ?? 0;

  return linhas.map((l) => ({ ...l, realizadas: de(l.profissionalId, 'realizada'), faltas: de(l.profissionalId, 'falta') }));
}

/** Quantos pedidos esperam a decisão do Anfitrião (alerta do menu e do Início). */
export async function contarSolicitacoes(espacoId: string): Promise<number> {
  const [linha] = await db
    .select({ total: count() })
    .from(schema.reserva)
    .where(and(eq(schema.reserva.espacoId, espacoId), eq(schema.reserva.status, 'solicitada')));
  return linha.total;
}

type Contexto = { ip?: string | null };

/**
 * Aprova um pedido: ele passa a esperar o pagamento, com prazo (D3: N horas, mas nunca depois
 * de 6 horas antes do início), e o Profissional recebe os dados do Pix por e-mail. Se o cadastro
 * ainda está pendente, só aprova junto com ele (`aprovarCadastro`), como na jornada A3.
 */
export async function aprovarReserva(
  reservaId: string,
  anfitriaoId: string,
  opcoes: Contexto & { aprovarCadastro?: boolean } = {},
  agora = new Date(),
) {
  const [r] = await db
    .select({
      reserva: schema.reserva,
      profissionalStatus: schema.profissional.status,
      nome: schema.usuario.name,
      email: schema.usuario.email,
      horasPagamento: schema.regraEspaco.prazoPagamentoHoras,
      corteHoras: schema.regraEspaco.corteAntesInicioHoras,
    })
    .from(schema.reserva)
    .innerJoin(schema.profissional, eq(schema.profissional.usuarioId, schema.reserva.profissionalId))
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.profissional.usuarioId))
    .innerJoin(schema.regraEspaco, eq(schema.regraEspaco.espacoId, schema.reserva.espacoId))
    .where(eq(schema.reserva.id, reservaId));
  if (!r) throw new ReservaNaoEncontradaError();
  if (r.reserva.status !== 'solicitada') throw new EstadoReservaError(r.reserva.status);
  if (r.reserva.prazoAprovacaoAte && agora >= r.reserva.prazoAprovacaoAte) throw new PrazoVencidoError();
  if (r.profissionalStatus === 'recusado') throw new EstadoReservaError('cadastro recusado');

  if (r.profissionalStatus === 'pendente') {
    if (!opcoes.aprovarCadastro) throw new CadastroPendenteError();
    try {
      await aprovarProfissional(r.reserva.profissionalId, anfitriaoId, opcoes.ip ?? null);
    } catch (e) {
      // Outra pessoa pode ter aprovado o cadastro no mesmo instante: tudo bem, o objetivo foi atingido.
      if (!(e instanceof TransicaoInvalidaError)) throw e;
    }
  }

  const prazoPagamentoAte = new Date(
    Math.min(agora.getTime() + r.horasPagamento * HORA_MS, r.reserva.inicio.getTime() - r.corteHoras * HORA_MS),
  );

  const { creditoUsado, valorAPagar, cobrancaId } = await db.transaction(async (tx) => {
    // D8: o crédito que vence primeiro abate o valor. Tudo na mesma transação da decisão: se outra
    // pessoa decidir o pedido no mesmo instante, nada do crédito é gasto.
    const creditoUsado = r.reserva.usarCredito
      ? await usarCredito(tx, { profissionalId: r.reserva.profissionalId, ate: r.reserva.valorCentavos, reservaId }, agora)
      : 0;
    const valorAPagar = r.reserva.valorCentavos - creditoUsado;
    const pagaComCredito = valorAPagar === 0;

    // A condição no WHERE garante uma única decisão por pedido, mesmo com dois cliques ao mesmo tempo.
    const mudou = await tx
      .update(schema.reserva)
      .set(
        pagaComCredito
          ? { status: 'confirmada', aprovadaPor: anfitriaoId, aprovadaEm: agora, prazoPagamentoAte: null }
          : { status: 'aguardando_pagamento', aprovadaPor: anfitriaoId, aprovadaEm: agora, prazoPagamentoAte },
      )
      .where(and(eq(schema.reserva.id, reservaId), eq(schema.reserva.status, 'solicitada')))
      .returning({ id: schema.reserva.id });
    if (mudou.length === 0) throw new EstadoReservaError('já decidida');

    const [cobranca] = await tx
      .insert(schema.cobranca)
      .values({
        profissionalId: r.reserva.profissionalId,
        finalidade: 'reserva',
        valorBrutoCentavos: r.reserva.valorCheioCentavos,
        descontoCentavos: r.reserva.descontoCentavos,
        creditoUsadoCentavos: creditoUsado,
        valorCobradoCentavos: valorAPagar,
        ...(pagaComCredito ? { status: 'paga' as const, meio: 'credito' as const, pagoEm: agora } : { venceEm: prazoPagamentoAte }),
      })
      .returning({ id: schema.cobranca.id });
    await tx.insert(schema.cobrancaItem).values({ cobrancaId: cobranca.id, reservaId, valorCentavos: r.reserva.valorCentavos });
    return { creditoUsado, valorAPagar, cobrancaId: cobranca.id };
  });

  await registrarAuditoria({
    usuarioId: anfitriaoId,
    acao: 'reserva_aprovada',
    entidade: 'reserva',
    entidadeId: reservaId,
    dados: { prazoPagamentoAte: prazoPagamentoAte.toISOString(), creditoUsado, valorAPagar },
    ip: opcoes.ip ?? null,
  });

  const periodo = descreverPeriodo(r.reserva.inicio, r.reserva.fim);
  // Pix online (Asaas), se ligado; se desligado ou se o Asaas falhar, o e-mail leva os dados do Pix manual.
  const online = valorAPagar > 0 ? await prepararPagamentoOnline(cobrancaId, `Reserva da sala: ${periodo}`) : null;
  // Paga inteira com crédito: já está confirmada, então o aviso é o de pagamento confirmado.
  const m =
    valorAPagar === 0
      ? emailPagamentoConfirmado({ nome: r.nome, periodo, valor: formatarReais(r.reserva.valorCentavos), reservaId, credito: true })
      : emailReservaAprovada({
          nome: r.nome,
          periodo,
          valor: formatarReais(valorAPagar),
          creditoUsado: creditoUsado > 0 ? formatarReais(creditoUsado) : null,
          prazoPagamento: descreverMomento(prazoPagamentoAte),
          pix: pixManual(),
          online,
          reservaId,
        });
  await notificar({
    usuarioId: r.reserva.profissionalId,
    para: r.email,
    tipo: valorAPagar === 0 ? 'pagamento_confirmado' : 'reserva_aprovada',
    assunto: m.assunto,
    html: m.html,
    referenciaTipo: 'reserva',
    referenciaId: reservaId,
  });
  return { prazoPagamentoAte, creditoUsado, valorAPagar, confirmada: valorAPagar === 0 };
}

/** Recusa um pedido: o horário é liberado na mesma transação e o Profissional é avisado. */
export async function recusarReserva(reservaId: string, anfitriaoId: string, motivo: string | null, opcoes: Contexto = {}) {
  const [r] = await db
    .select({ reserva: schema.reserva, nome: schema.usuario.name, email: schema.usuario.email })
    .from(schema.reserva)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.reserva.profissionalId))
    .where(eq(schema.reserva.id, reservaId));
  if (!r) throw new ReservaNaoEncontradaError();
  if (r.reserva.status !== 'solicitada') throw new EstadoReservaError(r.reserva.status);

  await db.transaction(async (tx) => {
    const mudou = await tx
      .update(schema.reserva)
      .set({ status: 'recusada', motivoRecusa: motivo, aprovadaPor: anfitriaoId, aprovadaEm: new Date() })
      .where(and(eq(schema.reserva.id, reservaId), eq(schema.reserva.status, 'solicitada')))
      .returning({ id: schema.reserva.id });
    if (mudou.length === 0) throw new EstadoReservaError('já decidida');
    await tx.delete(schema.ocupacao).where(eq(schema.ocupacao.reservaId, reservaId));
  });

  await registrarAuditoria({
    usuarioId: anfitriaoId,
    acao: 'reserva_recusada',
    entidade: 'reserva',
    entidadeId: reservaId,
    dados: { motivo },
    ip: opcoes.ip ?? null,
  });

  const m = emailReservaRecusada({ nome: r.nome, periodo: descreverPeriodo(r.reserva.inicio, r.reserva.fim), motivo });
  await notificar({
    usuarioId: r.reserva.profissionalId,
    para: r.email,
    tipo: 'reserva_recusada',
    assunto: m.assunto,
    html: m.html,
    referenciaTipo: 'reserva',
    referenciaId: reservaId,
  });
}
