import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { registrarAuditoria } from '@/modulos/auditoria/auditoria';
import { emailFaltaRegistrada } from '@/modulos/comunicacao/modelos';
import { notificar } from '@/modulos/comunicacao/notificar';
import { descreverPeriodo } from './calendario';
import { EstadoReservaError, ReservaNaoEncontradaError } from './solicitacao';

/** Só dá para registrar falta de um horário que já começou. */
export class ReservaNaoIniciadaError extends Error {
  constructor() {
    super('A reserva ainda não começou.');
    this.name = 'ReservaNaoIniciadaError';
  }
}

/**
 * O Anfitrião registra que a pessoa não usou a sala (falta). Vale para reserva confirmada ou já
 * encerrada como realizada, depois do início. Não gera crédito (o horário ficou reservado) e
 * aparece no histórico da pessoa na hora de aprovar novos pedidos. O código de acesso é apagado.
 */
export async function registrarFalta(reservaId: string, anfitriaoId: string, opcoes: { ip?: string | null } = {}, agora = new Date()) {
  const [r] = await db
    .select({ reserva: schema.reserva, nome: schema.usuario.name, email: schema.usuario.email })
    .from(schema.reserva)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.reserva.profissionalId))
    .where(eq(schema.reserva.id, reservaId));
  if (!r) throw new ReservaNaoEncontradaError();
  if (r.reserva.status !== 'confirmada' && r.reserva.status !== 'realizada') throw new EstadoReservaError(r.reserva.status);
  if (r.reserva.inicio > agora) throw new ReservaNaoIniciadaError();

  const mudou = await db
    .update(schema.reserva)
    .set({ status: 'falta', codigoAcesso: null })
    .where(and(eq(schema.reserva.id, reservaId), inArray(schema.reserva.status, ['confirmada', 'realizada'])))
    .returning({ id: schema.reserva.id });
  if (mudou.length === 0) throw new EstadoReservaError('já decidida');

  await registrarAuditoria({ usuarioId: anfitriaoId, acao: 'falta_registrada', entidade: 'reserva', entidadeId: reservaId, ip: opcoes.ip ?? null });

  const m = emailFaltaRegistrada({ nome: r.nome, periodo: descreverPeriodo(r.reserva.inicio, r.reserva.fim) });
  await notificar({
    usuarioId: r.reserva.profissionalId,
    para: r.email,
    tipo: 'falta_registrada',
    assunto: m.assunto,
    html: m.html,
    referenciaTipo: 'reserva',
    referenciaId: reservaId,
  });
}

/** Desfaz uma falta registrada por engano: a reserva volta a `realizada` (ou `confirmada`, se ainda não terminou). */
export async function desfazerFalta(reservaId: string, anfitriaoId: string, opcoes: { ip?: string | null } = {}, agora = new Date()) {
  const [r] = await db.select({ status: schema.reserva.status, fim: schema.reserva.fim }).from(schema.reserva).where(eq(schema.reserva.id, reservaId));
  if (!r) throw new ReservaNaoEncontradaError();
  if (r.status !== 'falta') throw new EstadoReservaError(r.status);

  const mudou = await db
    .update(schema.reserva)
    .set({ status: r.fim > agora ? 'confirmada' : 'realizada' })
    .where(and(eq(schema.reserva.id, reservaId), eq(schema.reserva.status, 'falta')))
    .returning({ id: schema.reserva.id });
  if (mudou.length === 0) throw new EstadoReservaError('já decidida');
  await registrarAuditoria({ usuarioId: anfitriaoId, acao: 'falta_desfeita', entidade: 'reserva', entidadeId: reservaId, ip: opcoes.ip ?? null });
}
