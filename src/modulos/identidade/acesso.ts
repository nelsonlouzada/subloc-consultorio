import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { registrarAuditoria } from '@/modulos/auditoria/auditoria';

/**
 * Acesso à conta (T23), separado do estado do cadastro: bloquear um profissional o impede de
 * reservar, mas ele ainda entra e vê o que já tem. Desativar o acesso fecha o login e derruba as
 * sessões abertas. Vale só para profissionais: contas de Anfitrião não se desativam por aqui.
 */

/** Falta de `ativo` (conta antiga, sessão sem o campo) conta como ativa: só `false` tira o acesso. */
export const contaAtiva = (usuario: { ativo?: boolean | null } | null | undefined): boolean => usuario != null && usuario.ativo !== false;

export class AcessoInvalidoError extends Error {
  constructor(public readonly motivo: 'nao_encontrado' | 'proprio' | 'estado') {
    super(`Mudança de acesso inválida: ${motivo}`);
  }
}

async function mudarAcesso(profissionalId: string, porId: string, ativo: boolean, motivo: string | null, ip: string | null) {
  if (profissionalId === porId) throw new AcessoInvalidoError('proprio');

  await db.transaction(async (tx) => {
    const [alvo] = await tx
      .select({ ativo: schema.usuario.ativo })
      .from(schema.profissional)
      .innerJoin(schema.usuario, eq(schema.usuario.id, schema.profissional.usuarioId))
      .where(eq(schema.profissional.usuarioId, profissionalId))
      .for('update');
    if (!alvo) throw new AcessoInvalidoError('nao_encontrado');
    if (alvo.ativo === ativo) throw new AcessoInvalidoError('estado');

    await tx.update(schema.usuario).set({ ativo }).where(and(eq(schema.usuario.id, profissionalId), eq(schema.usuario.papel, 'profissional')));
    if (!ativo) await tx.delete(schema.sessao).where(eq(schema.sessao.userId, profissionalId));
  });

  await registrarAuditoria({
    usuarioId: porId,
    acao: ativo ? 'acesso_reativado' : 'acesso_desativado',
    entidade: 'profissional',
    entidadeId: profissionalId,
    dados: { motivo },
    ip,
  });
}

export const desativarAcesso = (profissionalId: string, porId: string, motivo: string | null, ip: string | null = null) =>
  mudarAcesso(profissionalId, porId, false, motivo, ip);

export const reativarAcesso = (profissionalId: string, porId: string, ip: string | null = null) => mudarAcesso(profissionalId, porId, true, null, ip);
