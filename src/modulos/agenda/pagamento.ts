import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { formatarReais } from '@/lib/dinheiro';
import { registrarAuditoria } from '@/modulos/auditoria/auditoria';
import { concederCredito, usarCredito } from '@/modulos/carteira/carteira';
import { emitirReciboSemFalhar } from '@/modulos/cobranca/recibo';
import { emailPagamentoAtrasadoVirouCredito, emailPagamentoConfirmado } from '@/modulos/comunicacao/modelos';
import { notificar } from '@/modulos/comunicacao/notificar';
import { descreverPeriodo } from './calendario';
import { ConflitoAgendaError, registrarOcupacao } from './ocupacao';
import { EstadoReservaError, ReservaNaoEncontradaError } from './solicitacao';

/** O Pix chegou depois da expiração, mas o crédito que abatia o pedido já foi devolvido e não há saldo para abater de novo. */
export class CreditoInsuficienteError extends Error {
  constructor() {
    super('O crédito que abatia este pedido já foi devolvido e o saldo atual não cobre.');
    this.name = 'CreditoInsuficienteError';
  }
}

export type ResultadoPagamento = {
  /** O pedido tinha expirado e voltou: o horário ainda estava livre. */
  reativada: boolean;
  /** O pedido tinha expirado e o horário já não estava livre: o valor pago virou crédito. */
  creditoCentavos: number;
};

/**
 * O Anfitrião confirma que o Pix chegou (E2: pagamento manual). A reserva fica confirmada e a
 * cobrança, paga com meio `pix_manual` e o nome de quem marcou.
 *
 * Se o prazo de pagamento já venceu e o pedido expirou, o dinheiro chegou mesmo assim (decisão
 * T1): se o horário ainda está livre, a reserva volta e é confirmada; se não está (ou já
 * começou), o valor pago vira crédito na carteira, com origem `pagamento_atrasado`.
 */
export async function marcarPago(
  reservaId: string,
  anfitriaoId: string,
  opcoes: { ip?: string | null } = {},
  agora = new Date(),
): Promise<ResultadoPagamento> {
  return confirmarPagamento(reservaId, { usuarioId: anfitriaoId, meio: 'pix_manual' }, opcoes, agora);
}

/** Quem confirmou e como: o Anfitrião (Pix manual) ou o sistema, a partir do aviso do Asaas (usuarioId nulo). */
export type OrigemPagamento = { usuarioId: string | null; meio: 'pix_manual' | 'pix' | 'cartao' };

/**
 * Regra única de "o dinheiro chegou" para uma reserva, usada pelo Anfitrião (`marcarPago`) e pelo
 * webhook do Asaas. Confirma a reserva, ou, se o pedido já tinha expirado, reativa (horário livre)
 * ou transforma o valor em crédito (horário perdido).
 */
export async function confirmarPagamento(
  reservaId: string,
  quem: OrigemPagamento,
  opcoes: { ip?: string | null } = {},
  agora = new Date(),
): Promise<ResultadoPagamento> {
  const [r] = await db
    .select({
      reserva: schema.reserva,
      cobrancaId: schema.cobranca.id,
      cobrancaStatus: schema.cobranca.status,
      valorCobradoCentavos: schema.cobranca.valorCobradoCentavos,
      creditoUsadoCentavos: schema.cobranca.creditoUsadoCentavos,
      nome: schema.usuario.name,
      email: schema.usuario.email,
      travaMinutos: schema.regraEspaco.travaMinutos,
    })
    .from(schema.reserva)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.reserva.profissionalId))
    .innerJoin(schema.regraEspaco, eq(schema.regraEspaco.espacoId, schema.reserva.espacoId))
    .innerJoin(schema.cobrancaItem, eq(schema.cobrancaItem.reservaId, schema.reserva.id))
    .innerJoin(schema.cobranca, eq(schema.cobranca.id, schema.cobrancaItem.cobrancaId))
    .where(eq(schema.reserva.id, reservaId));
  if (!r) {
    // Sem cobrança ligada a esta reserva: ou ela não existe, ou nunca foi aprovada.
    const [existe] = await db.select({ status: schema.reserva.status }).from(schema.reserva).where(eq(schema.reserva.id, reservaId));
    if (!existe) throw new ReservaNaoEncontradaError();
    throw new EstadoReservaError(existe.status);
  }

  const reativando = r.reserva.status === 'expirada' && r.cobrancaStatus === 'expirada';
  if (r.reserva.status !== 'aguardando_pagamento' && !reativando) throw new EstadoReservaError(r.reserva.status);

  const periodo = descreverPeriodo(r.reserva.inicio, r.reserva.fim);

  // O dinheiro chegou, mas o horário não volta: vira crédito (só a cobrança muda, a reserva segue expirada).
  const virarCredito = async (): Promise<ResultadoPagamento> => {
    await db.transaction(async (tx) => {
      const mudou = await tx
        .update(schema.cobranca)
        .set({ status: 'paga', meio: quem.meio, marcadaPagaPor: quem.usuarioId, pagoEm: agora })
        .where(and(eq(schema.cobranca.id, r.cobrancaId), eq(schema.cobranca.status, 'expirada')))
        .returning({ id: schema.cobranca.id });
      if (mudou.length === 0) throw new EstadoReservaError('já decidida');
      await concederCredito(
        tx,
        {
          profissionalId: r.reserva.profissionalId,
          espacoId: r.reserva.espacoId,
          origem: 'pagamento_atrasado',
          valorCentavos: r.valorCobradoCentavos,
          reservaId,
          cobrancaId: r.cobrancaId,
          criadoPor: quem.usuarioId,
        },
        agora,
      );
    });
    await emitirReciboSemFalhar(r.cobrancaId);
    await registrarAuditoria({
      usuarioId: quem.usuarioId,
      acao: 'pagamento_atrasado_virou_credito',
      entidade: 'reserva',
      entidadeId: reservaId,
      dados: { valorCentavos: r.valorCobradoCentavos },
      ip: opcoes.ip ?? null,
    });
    const m = emailPagamentoAtrasadoVirouCredito({ nome: r.nome, periodo, valor: formatarReais(r.valorCobradoCentavos) });
    await notificar({
      usuarioId: r.reserva.profissionalId,
      para: r.email,
      tipo: 'pagamento_atrasado_credito',
      assunto: m.assunto,
      html: m.html,
      referenciaTipo: 'reserva',
      referenciaId: reservaId,
    });
    return { reativada: false, creditoCentavos: r.valorCobradoCentavos };
  };

  if (reativando && r.reserva.inicio <= agora) return virarCredito();

  try {
    await db.transaction(async (tx) => {
      if (reativando) {
        // Tenta reter o horário de novo: quem decide se ainda está livre é o banco.
        await registrarOcupacao(tx, {
          espacoId: r.reserva.espacoId,
          inicio: r.reserva.inicio,
          fim: r.reserva.fim,
          ocupante: `prof:${r.reserva.profissionalId}`,
          geraTrava: true,
          travaMinutos: r.travaMinutos,
          reservaId,
        });
        // O crédito que abatia o pedido foi devolvido na expiração: abate de novo, ou desfaz tudo.
        if (r.creditoUsadoCentavos > 0) {
          const usado = await usarCredito(tx, { profissionalId: r.reserva.profissionalId, ate: r.creditoUsadoCentavos, reservaId }, agora);
          if (usado < r.creditoUsadoCentavos) throw new CreditoInsuficienteError();
        }
      }
      // A condição no WHERE impede marcar duas vezes ou competir com a expiração.
      const mudou = await tx
        .update(schema.reserva)
        .set({ status: 'confirmada' })
        .where(and(eq(schema.reserva.id, reservaId), eq(schema.reserva.status, reativando ? 'expirada' : 'aguardando_pagamento')))
        .returning({ id: schema.reserva.id });
      if (mudou.length === 0) throw new EstadoReservaError('já decidida');
      await tx
        .update(schema.cobranca)
        .set({ status: 'paga', meio: quem.meio, marcadaPagaPor: quem.usuarioId, pagoEm: agora })
        .where(eq(schema.cobranca.id, r.cobrancaId));
    });
  } catch (e) {
    if (e instanceof ConflitoAgendaError) return virarCredito();
    throw e;
  }

  await emitirReciboSemFalhar(r.cobrancaId);
  await registrarAuditoria({
    usuarioId: quem.usuarioId,
    acao: reativando ? 'pagamento_marcado_apos_expirar' : 'pagamento_marcado',
    entidade: 'reserva',
    entidadeId: reservaId,
    dados: { valorCentavos: r.valorCobradoCentavos, creditoUsadoCentavos: r.creditoUsadoCentavos, meio: quem.meio },
    ip: opcoes.ip ?? null,
  });

  const m = emailPagamentoConfirmado({
    nome: r.nome,
    periodo,
    valor: formatarReais(r.valorCobradoCentavos),
    reservaId,
  });
  await notificar({
    usuarioId: r.reserva.profissionalId,
    para: r.email,
    tipo: 'pagamento_confirmado',
    assunto: m.assunto,
    html: m.html,
    referenciaTipo: 'reserva',
    referenciaId: reservaId,
  });
  return { reativada: reativando, creditoCentavos: 0 };
}
