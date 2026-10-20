import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';

export type EventoAuditoria = {
  /** Quem fez. Nulo = o próprio sistema (jobs). */
  usuarioId: string | null;
  acao: string;
  entidade: string;
  entidadeId?: string | null;
  dados?: Record<string, unknown>;
  ip?: string | null;
};

/** Responde "quem aprovou, cancelou ou deu crédito" (D7). Nunca guardar dado sensível em `dados`. */
export async function registrarAuditoria(e: EventoAuditoria): Promise<void> {
  await db.insert(schema.eventoAuditoria).values({
    usuarioId: e.usuarioId,
    acao: e.acao,
    entidade: e.entidade,
    entidadeId: e.entidadeId ?? null,
    dados: e.dados ?? null,
    ip: e.ip ?? null,
  });
}

/** Histórico de ações sobre uma entidade, do mais novo para o mais antigo, com o nome de quem agiu. */
export async function listarAuditoriaDe(entidade: string, entidadeId: string) {
  return db
    .select({
      acao: schema.eventoAuditoria.acao,
      quando: schema.eventoAuditoria.criadoEm,
      quem: schema.usuario.name,
      dados: schema.eventoAuditoria.dados,
    })
    .from(schema.eventoAuditoria)
    .leftJoin(schema.usuario, eq(schema.usuario.id, schema.eventoAuditoria.usuarioId))
    .where(and(eq(schema.eventoAuditoria.entidade, entidade), eq(schema.eventoAuditoria.entidadeId, entidadeId)))
    .orderBy(desc(schema.eventoAuditoria.criadoEm));
}
