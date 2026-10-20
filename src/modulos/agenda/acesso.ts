import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/db';
import { registrarAuditoria } from '@/modulos/auditoria/auditoria';
import { emailCodigoAcesso } from '@/modulos/comunicacao/modelos';
import { notificar } from '@/modulos/comunicacao/notificar';
import { descreverPeriodo } from './calendario';
import { EstadoReservaError, ReservaNaoEncontradaError } from './solicitacao';

/** Código da fechadura: dígitos e letras, e os símbolos que alguns teclados usam. */
export const esquemaCodigo = z
  .string()
  .trim()
  .regex(/^[0-9A-Za-z*#-]{3,20}$/, 'Use de 3 a 20 caracteres: números, letras, * # ou -.');

export class CodigoInvalidoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'CodigoInvalidoError';
  }
}

/**
 * O Anfitrião digita o código gerado no app da fechadura (E2: envio manual) e o sistema o manda
 * por e-mail. O código fica na reserva até ela terminar (o Profissional vê na tela) e é apagado
 * depois pelo job de encerramento. Pode ser reenviado, e cada envio fica registrado.
 */
export async function enviarCodigoAcesso(
  reservaId: string,
  anfitriaoId: string,
  codigoBruto: string,
  opcoes: { ip?: string | null } = {},
  agora = new Date(),
) {
  const lido = esquemaCodigo.safeParse(codigoBruto);
  if (!lido.success) throw new CodigoInvalidoError(lido.error.issues[0].message);
  const codigo = lido.data;

  const [r] = await db
    .select({ reserva: schema.reserva, nome: schema.usuario.name, email: schema.usuario.email })
    .from(schema.reserva)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.reserva.profissionalId))
    .where(eq(schema.reserva.id, reservaId));
  if (!r) throw new ReservaNaoEncontradaError();
  if (r.reserva.status !== 'confirmada' || r.reserva.fim <= agora) throw new EstadoReservaError(r.reserva.status);

  const mudou = await db
    .update(schema.reserva)
    .set({ codigoAcesso: codigo, codigoAcessoEnviadoPor: anfitriaoId, codigoAcessoEnviadoEm: agora })
    .where(and(eq(schema.reserva.id, reservaId), eq(schema.reserva.status, 'confirmada')))
    .returning({ id: schema.reserva.id });
  if (mudou.length === 0) throw new EstadoReservaError('já mudou');

  // O código em si nunca vai para a auditoria: só o fato de ter sido enviado.
  await registrarAuditoria({
    usuarioId: anfitriaoId,
    acao: 'codigo_acesso_enviado',
    entidade: 'reserva',
    entidadeId: reservaId,
    ip: opcoes.ip ?? null,
  });

  const m = emailCodigoAcesso({ nome: r.nome, periodo: descreverPeriodo(r.reserva.inicio, r.reserva.fim), codigo, reservaId });
  return notificar({
    usuarioId: r.reserva.profissionalId,
    para: r.email,
    tipo: 'codigo_acesso',
    assunto: m.assunto,
    html: m.html,
    referenciaTipo: 'reserva',
    // Reenvio é permitido: cada envio tem a própria chave, para não ser tratado como duplicado.
    referenciaId: `${reservaId}:${agora.getTime()}`,
  });
}
