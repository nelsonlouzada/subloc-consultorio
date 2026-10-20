import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { formatarReais } from '@/lib/dinheiro';
import { registrarAuditoria } from '@/modulos/auditoria/auditoria';
import { emailPagamentoConfirmado } from '@/modulos/comunicacao/modelos';
import { notificar } from '@/modulos/comunicacao/notificar';
import { usarCredito } from '@/modulos/carteira/carteira';
import { descreverPeriodo } from './calendario';
import { ConflitoAgendaError, registrarOcupacao } from './ocupacao';
import { EstadoReservaError, ReservaNaoEncontradaError } from './solicitacao';

/** O pagamento chegou depois da expiração e o horário já não está livre (ou já começou). */
export class HorarioIndisponivelError extends Error {
  constructor() {
    super('O pedido já expirou e o horário não está mais livre.');
    this.name = 'HorarioIndisponivelError';
  }
}

/** O Pix chegou depois da expiração, mas o crédito que abatia o pedido já foi devolvido e não há saldo para abater de novo. */
export class CreditoInsuficienteError extends Error {
  constructor() {
    super('O crédito que abatia este pedido já foi devolvido e o saldo atual não cobre.');
    this.name = 'CreditoInsuficienteError';
  }
}

/**
 * O Anfitrião confirma que o Pix chegou (E2: pagamento manual). A reserva fica confirmada e a
 * cobrança, paga com meio `pix_manual` e o nome de quem marcou.
 *
 * Se o prazo de pagamento já venceu e o pedido expirou, o dinheiro chegou mesmo assim: se o
 * horário ainda está livre, a reserva volta e é confirmada (decisão T1); se não está, devolve
 * `HorarioIndisponivelError` e o Anfitrião resolve por fora (o crédito automático chega na E3).
 */
export async function marcarPago(
  reservaId: string,
  anfitriaoId: string,
  opcoes: { ip?: string | null } = {},
  agora = new Date(),
) {
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
  if (reativando && r.reserva.inicio <= agora) throw new HorarioIndisponivelError();

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
        .set({ status: 'paga', meio: 'pix_manual', marcadaPagaPor: anfitriaoId, pagoEm: agora })
        .where(eq(schema.cobranca.id, r.cobrancaId));
    });
  } catch (e) {
    if (e instanceof ConflitoAgendaError) throw new HorarioIndisponivelError();
    throw e;
  }

  await registrarAuditoria({
    usuarioId: anfitriaoId,
    acao: reativando ? 'pagamento_marcado_apos_expirar' : 'pagamento_marcado',
    entidade: 'reserva',
    entidadeId: reservaId,
    dados: { valorCentavos: r.valorCobradoCentavos, creditoUsadoCentavos: r.creditoUsadoCentavos, meio: 'pix_manual' },
    ip: opcoes.ip ?? null,
  });

  const m = emailPagamentoConfirmado({
    nome: r.nome,
    periodo: descreverPeriodo(r.reserva.inicio, r.reserva.fim),
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
  return { reativada: reativando };
}
