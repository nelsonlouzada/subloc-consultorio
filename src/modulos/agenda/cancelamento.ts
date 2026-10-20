import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { registrarAuditoria } from '@/modulos/auditoria/auditoria';
import { concederCredito, devolverUso } from '@/modulos/carteira/carteira';
import { emailReservaCancelada } from '@/modulos/comunicacao/modelos';
import { notificar } from '@/modulos/comunicacao/notificar';
import { formatarReais } from '@/lib/dinheiro';
import { descreverPeriodo } from './calendario';
import { EstadoReservaError, ReservaNaoEncontradaError } from './solicitacao';

/** A reserva já começou: não dá mais para cancelar pelo sistema. */
export class ReservaJaIniciadaError extends Error {
  constructor() {
    super('A reserva já começou e não pode mais ser cancelada.');
    this.name = 'ReservaJaIniciadaError';
  }
}

/**
 * O Anfitrião cancela uma reserva aprovada (aguardando pagamento ou confirmada) que ainda não
 * começou. O horário é liberado e o código de acesso apagado na mesma transação.
 *
 * Se o pagamento já tinha sido marcado, o valor pago volta como crédito integral na carteira
 * (cancelamento pelo Anfitrião não tem desconto), na mesma transação.
 */
export async function cancelarReserva(
  reservaId: string,
  anfitriaoId: string,
  motivo: string | null,
  opcoes: { ip?: string | null } = {},
  agora = new Date(),
): Promise<{ creditoCentavos: number }> {
  const [r] = await db
    .select({ reserva: schema.reserva, nome: schema.usuario.name, email: schema.usuario.email })
    .from(schema.reserva)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.reserva.profissionalId))
    .where(eq(schema.reserva.id, reservaId));
  if (!r) throw new ReservaNaoEncontradaError();
  if (r.reserva.status !== 'aguardando_pagamento' && r.reserva.status !== 'confirmada') throw new EstadoReservaError(r.reserva.status);
  if (r.reserva.inicio <= agora) throw new ReservaJaIniciadaError();

  const motivoLimpo = motivo?.trim() ? motivo.trim().slice(0, 500) : null;

  const creditoCentavos = await db.transaction(async (tx) => {
    // A condição no WHERE impede cancelar duas vezes ou competir com a expiração.
    const mudou = await tx
      .update(schema.reserva)
      .set({ status: 'cancelada', canceladaPor: anfitriaoId, canceladaEm: agora, codigoAcesso: null })
      .where(and(eq(schema.reserva.id, reservaId), inArray(schema.reserva.status, ['aguardando_pagamento', 'confirmada'])))
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

    if (!itens.some((i) => i.status === 'paga')) return 0;
    const valor = r.reserva.valorCentavos;
    if (valor <= 0) return 0;
    await concederCredito(
      tx,
      { profissionalId: r.reserva.profissionalId, espacoId: r.reserva.espacoId, origem: 'cancelamento', valorCentavos: valor, reservaId, criadoPor: anfitriaoId },
      agora,
    );
    await tx.update(schema.reserva).set({ creditoGeradoCentavos: valor }).where(eq(schema.reserva.id, reservaId));
    return valor;
  });

  await registrarAuditoria({
    usuarioId: anfitriaoId,
    acao: 'reserva_cancelada',
    entidade: 'reserva',
    entidadeId: reservaId,
    dados: { motivo: motivoLimpo, creditoCentavos, statusAnterior: r.reserva.status },
    ip: opcoes.ip ?? null,
  });

  const m = emailReservaCancelada({
    nome: r.nome,
    periodo: descreverPeriodo(r.reserva.inicio, r.reserva.fim),
    motivo: motivoLimpo,
    credito: creditoCentavos > 0 ? formatarReais(creditoCentavos) : null,
  });
  await notificar({
    usuarioId: r.reserva.profissionalId,
    para: r.email,
    tipo: 'reserva_cancelada',
    assunto: m.assunto,
    html: m.html,
    referenciaTipo: 'reserva',
    referenciaId: reservaId,
  });
  return { creditoCentavos };
}
