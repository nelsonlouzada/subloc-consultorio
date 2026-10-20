import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { formatarReais } from '@/lib/dinheiro';
import { registrarAuditoria } from '@/modulos/auditoria/auditoria';
import { concederCredito, creditoPorCancelamento, devolverUso } from '@/modulos/carteira/carteira';
import { emailCancelamentoAvisoAnfitriao, emailCancelamentoConfirmado, emailReservaCancelada } from '@/modulos/comunicacao/modelos';
import { anfitrioesAtivos, notificar } from '@/modulos/comunicacao/notificar';
import { descreverPeriodo } from './calendario';
import { EstadoReservaError, ReservaNaoEncontradaError } from './solicitacao';

/** A reserva já começou: não dá mais para cancelar pelo sistema. */
export class ReservaJaIniciadaError extends Error {
  constructor() {
    super('A reserva já começou e não pode mais ser cancelada.');
    this.name = 'ReservaJaIniciadaError';
  }
}

type Quem = { id: string; papel: 'anfitriao' | 'profissional' };
type Opcoes = { ip?: string | null };
type Cancelavel = 'solicitada' | 'aguardando_pagamento' | 'confirmada';

// O Anfitrião só cancela o que já foi aprovado (pedido em análise se recusa); o Profissional
// também pode retirar o próprio pedido que ainda espera resposta.
const STATUS_CANCELAVEIS: Record<Quem['papel'], Cancelavel[]> = {
  anfitriao: ['aguardando_pagamento', 'confirmada'],
  profissional: ['solicitada', 'aguardando_pagamento', 'confirmada'],
};

async function carregar(reservaId: string, quem: Quem) {
  const [r] = await db
    .select({
      reserva: schema.reserva,
      nome: schema.usuario.name,
      email: schema.usuario.email,
      integralHoras: schema.regraEspaco.cancelamentoIntegralHoras,
      parcialHoras: schema.regraEspaco.cancelamentoParcialHoras,
      parcialPct: schema.regraEspaco.cancelamentoParcialPct,
    })
    .from(schema.reserva)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.reserva.profissionalId))
    .innerJoin(schema.regraEspaco, eq(schema.regraEspaco.espacoId, schema.reserva.espacoId))
    .where(eq(schema.reserva.id, reservaId));
  // Reserva de outra pessoa é como se não existisse.
  if (!r || (quem.papel === 'profissional' && r.reserva.profissionalId !== quem.id)) throw new ReservaNaoEncontradaError();
  return r;
}

const politicaDe = (r: { integralHoras: number; parcialHoras: number; parcialPct: number }) => ({
  integralHoras: r.integralHoras,
  parcialHoras: r.parcialHoras,
  parcialPct: r.parcialPct,
});

/**
 * O que a profissional receberia se cancelasse agora, pela política da sala (nos valores padrão:
 * 100% com 48 h ou mais, 50% de 24 h a 48 h, nada abaixo). Só há crédito se o pagamento já foi
 * feito; pedido não pago não perde nada, e o crédito que o abatia volta inteiro.
 */
export async function previaCancelamento(reservaId: string, profissionalId: string, agora = new Date()) {
  const r = await carregar(reservaId, { id: profissionalId, papel: 'profissional' });
  const podeCancelar = STATUS_CANCELAVEIS.profissional.includes(r.reserva.status as Cancelavel) && r.reserva.inicio > agora;
  const [paga] = await db
    .select({ id: schema.cobranca.id })
    .from(schema.cobrancaItem)
    .innerJoin(schema.cobranca, eq(schema.cobranca.id, schema.cobrancaItem.cobrancaId))
    .where(and(eq(schema.cobrancaItem.reservaId, reservaId), eq(schema.cobranca.status, 'paga')));
  const pago = Boolean(paga);
  const { percentual, creditoCentavos } = pago
    ? creditoPorCancelamento(politicaDe(r), r.reserva.inicio, agora, r.reserva.valorCentavos)
    : { percentual: 0, creditoCentavos: 0 };
  return { podeCancelar, pago, percentual, creditoCentavos, valorCentavos: r.reserva.valorCentavos };
}

async function cancelar(reservaId: string, quem: Quem, motivo: string | null, opcoes: Opcoes, agora: Date) {
  const r = await carregar(reservaId, quem);
  const aceitos = STATUS_CANCELAVEIS[quem.papel];
  if (!aceitos.includes(r.reserva.status as Cancelavel)) throw new EstadoReservaError(r.reserva.status);
  if (r.reserva.inicio <= agora) throw new ReservaJaIniciadaError();

  const motivoLimpo = motivo?.trim() ? motivo.trim().slice(0, 500) : null;

  const resultado = await db.transaction(async (tx) => {
    // A condição no WHERE impede cancelar duas vezes ou competir com a expiração.
    const mudou = await tx
      .update(schema.reserva)
      .set({ status: 'cancelada', canceladaPor: quem.id, canceladaEm: agora, codigoAcesso: null })
      .where(and(eq(schema.reserva.id, reservaId), inArray(schema.reserva.status, aceitos)))
      .returning({ id: schema.reserva.id });
    if (mudou.length === 0) throw new EstadoReservaError('já decidida');
    await tx.delete(schema.ocupacao).where(eq(schema.ocupacao.reservaId, reservaId));

    const itens = await tx
      .select({ cobrancaId: schema.cobranca.id, status: schema.cobranca.status })
      .from(schema.cobrancaItem)
      .innerJoin(schema.cobranca, eq(schema.cobranca.id, schema.cobrancaItem.cobrancaId))
      .where(eq(schema.cobrancaItem.reservaId, reservaId));
    const pendentes = itens.filter((i) => i.status === 'pendente').map((i) => i.cobrancaId);
    if (pendentes.length) {
      await tx.update(schema.cobranca).set({ status: 'cancelada' }).where(inArray(schema.cobranca.id, pendentes));
      await devolverUso(tx, reservaId, agora); // o crédito que abateu o pedido volta inteiro
    }

    const pago = itens.some((i) => i.status === 'paga');
    if (!pago) return { pago, creditoCentavos: 0, percentual: 0 };
    // Cancelamento pelo Anfitrião não tem desconto; pela profissional vale a política da sala.
    const { percentual, creditoCentavos } =
      quem.papel === 'anfitriao'
        ? { percentual: 100, creditoCentavos: r.reserva.valorCentavos }
        : creditoPorCancelamento(politicaDe(r), r.reserva.inicio, agora, r.reserva.valorCentavos);
    if (creditoCentavos > 0) {
      await concederCredito(
        tx,
        { profissionalId: r.reserva.profissionalId, espacoId: r.reserva.espacoId, origem: 'cancelamento', valorCentavos: creditoCentavos, reservaId, criadoPor: quem.id },
        agora,
      );
      await tx.update(schema.reserva).set({ creditoGeradoCentavos: creditoCentavos }).where(eq(schema.reserva.id, reservaId));
    }
    return { pago, creditoCentavos, percentual };
  });

  await registrarAuditoria({
    usuarioId: quem.id,
    acao: quem.papel === 'anfitriao' ? 'reserva_cancelada' : 'reserva_cancelada_profissional',
    entidade: 'reserva',
    entidadeId: reservaId,
    dados: { motivo: motivoLimpo, ...resultado, statusAnterior: r.reserva.status },
    ip: opcoes.ip ?? null,
  });

  const periodo = descreverPeriodo(r.reserva.inicio, r.reserva.fim);
  const credito = resultado.creditoCentavos > 0 ? formatarReais(resultado.creditoCentavos) : null;
  const paraProfissional =
    quem.papel === 'anfitriao'
      ? { tipo: 'reserva_cancelada', ...emailReservaCancelada({ nome: r.nome, periodo, motivo: motivoLimpo, credito }) }
      : { tipo: 'cancelamento_confirmado', ...emailCancelamentoConfirmado({ nome: r.nome, periodo, credito, percentual: resultado.percentual, pago: resultado.pago }) };
  await notificar({
    usuarioId: r.reserva.profissionalId,
    para: r.email,
    tipo: paraProfissional.tipo,
    assunto: paraProfissional.assunto,
    html: paraProfissional.html,
    referenciaTipo: 'reserva',
    referenciaId: reservaId,
  });

  if (quem.papel === 'profissional') {
    // O Anfitrião precisa saber que o horário voltou a ficar livre.
    const aviso = emailCancelamentoAvisoAnfitriao({ nome: r.nome, periodo, credito, statusAnterior: r.reserva.status });
    for (const a of await anfitrioesAtivos()) {
      await notificar({
        usuarioId: a.id,
        para: a.email,
        tipo: 'reserva_cancelada_profissional',
        assunto: aviso.assunto,
        html: aviso.html,
        referenciaTipo: 'reserva',
        referenciaId: reservaId,
      });
    }
  }
  return resultado;
}

/**
 * O Anfitrião cancela uma reserva aprovada (aguardando pagamento ou confirmada) que ainda não
 * começou. O horário é liberado e o código de acesso apagado na mesma transação. Se o pagamento
 * já tinha sido feito, o valor volta como crédito integral na carteira.
 */
export async function cancelarReserva(
  reservaId: string,
  anfitriaoId: string,
  motivo: string | null,
  opcoes: Opcoes = {},
  agora = new Date(),
): Promise<{ creditoCentavos: number }> {
  const { creditoCentavos } = await cancelar(reservaId, { id: anfitriaoId, papel: 'anfitriao' }, motivo, opcoes, agora);
  return { creditoCentavos };
}

/**
 * A profissional cancela a própria reserva (ou retira um pedido ainda sem resposta). O crédito
 * segue a política da sala, calculada sobre o que foi pago; o horário é liberado, o código
 * apagado e os Anfitriões avisados.
 */
export async function cancelarReservaPeloProfissional(reservaId: string, profissionalId: string, opcoes: Opcoes = {}, agora = new Date()) {
  const { creditoCentavos, percentual } = await cancelar(reservaId, { id: profissionalId, papel: 'profissional' }, null, opcoes, agora);
  return { creditoCentavos, percentual };
}
