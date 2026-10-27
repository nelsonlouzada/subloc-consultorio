import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { registrarAuditoria } from '@/modulos/auditoria/auditoria';
import { emailCadastroAprovado, emailCadastroRecusado } from '@/modulos/comunicacao/modelos';
import { notificar } from '@/modulos/comunicacao/notificar';

export type StatusProfissional = 'pendente' | 'aprovado' | 'recusado' | 'bloqueado';

// Quem pode ir para onde. Um recusado pode ser reconsiderado; um aprovado pode ser bloqueado e
// desbloqueado. Aprovar quem já está aprovado, por exemplo, é erro: evita e-mail em dobro.
const TRANSICOES: Record<StatusProfissional, StatusProfissional[]> = {
  pendente: ['aprovado', 'recusado'],
  recusado: ['aprovado'],
  aprovado: ['bloqueado'],
  bloqueado: ['aprovado'],
};

export class TransicaoInvalidaError extends Error {
  constructor(de: StatusProfissional, para: StatusProfissional) {
    super(`Não é possível mudar o cadastro de "${de}" para "${para}".`);
    this.name = 'TransicaoInvalidaError';
  }
}

export class ProfissionalNaoEncontradoError extends Error {
  constructor() {
    super('Profissional não encontrado.');
    this.name = 'ProfissionalNaoEncontradoError';
  }
}

export async function listarProfissionais(status?: StatusProfissional) {
  return db
    .select({
      id: schema.profissional.usuarioId,
      nome: schema.usuario.name,
      email: schema.usuario.email,
      profissao: schema.profissional.profissao,
      conselho: schema.profissional.conselho,
      registroNumero: schema.profissional.registroNumero,
      registroUf: schema.profissional.registroUf,
      status: schema.profissional.status,
      criadoEm: schema.profissional.criadoEm,
    })
    .from(schema.profissional)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.profissional.usuarioId))
    .where(status ? eq(schema.profissional.status, status) : undefined)
    .orderBy(desc(schema.profissional.criadoEm));
}

export async function obterProfissional(id: string) {
  const [linha] = await db
    .select({
      id: schema.profissional.usuarioId,
      nome: schema.usuario.name,
      email: schema.usuario.email,
      emailVerificado: schema.usuario.emailVerified,
      acessoAtivo: schema.usuario.ativo,
      telefone: schema.usuario.telefone,
      cpf: schema.profissional.cpf,
      profissao: schema.profissional.profissao,
      conselho: schema.profissional.conselho,
      registroNumero: schema.profissional.registroNumero,
      registroUf: schema.profissional.registroUf,
      status: schema.profissional.status,
      avaliadoEm: schema.profissional.avaliadoEm,
      motivoAvaliacao: schema.profissional.motivoAvaliacao,
      criadoEm: schema.profissional.criadoEm,
    })
    .from(schema.profissional)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.profissional.usuarioId))
    .where(eq(schema.profissional.usuarioId, id));
  return linha ?? null;
}

const ABERTAS = ['solicitada', 'aguardando_pagamento'] as const;

async function mudarStatus(
  id: string,
  para: StatusProfissional,
  porId: string,
  motivo: string | null,
  ip: string | null,
) {
  const atual = await obterProfissional(id);
  if (!atual) throw new ProfissionalNaoEncontradoError();
  if (!TRANSICOES[atual.status].includes(para)) throw new TransicaoInvalidaError(atual.status, para);

  await db.transaction(async (tx) => {
    // A condição no WHERE protege de duas pessoas decidindo ao mesmo tempo: só uma muda o estado.
    const mudou = await tx
      .update(schema.profissional)
      .set({ status: para, avaliadoPor: porId, avaliadoEm: new Date(), motivoAvaliacao: motivo })
      .where(and(eq(schema.profissional.usuarioId, id), eq(schema.profissional.status, atual.status)))
      .returning({ id: schema.profissional.usuarioId });
    if (mudou.length === 0) throw new TransicaoInvalidaError(atual.status, para);

    // Recusar o cadastro recusa os pedidos em aberto e libera os horários na hora.
    if (para === 'recusado') {
      const abertas = await tx
        .update(schema.reserva)
        .set({ status: 'recusada', motivoRecusa: 'Cadastro não aprovado.' })
        .where(and(eq(schema.reserva.profissionalId, id), inArray(schema.reserva.status, [...ABERTAS])))
        .returning({ id: schema.reserva.id });
      if (abertas.length) {
        await tx.delete(schema.ocupacao).where(
          inArray(
            schema.ocupacao.reservaId,
            abertas.map((r) => r.id),
          ),
        );
      }
    }
  });

  await registrarAuditoria({
    usuarioId: porId,
    acao: `profissional_${para}`,
    entidade: 'profissional',
    entidadeId: id,
    dados: { de: atual.status, motivo },
    ip,
  });

  if (para === 'aprovado' && atual.status !== 'bloqueado') {
    const m = emailCadastroAprovado(atual.nome);
    await notificar({ usuarioId: id, para: atual.email, tipo: 'cadastro_aprovado', assunto: m.assunto, html: m.html, referenciaTipo: 'profissional', referenciaId: id });
  }
  if (para === 'recusado') {
    const m = emailCadastroRecusado(atual.nome, motivo);
    await notificar({ usuarioId: id, para: atual.email, tipo: 'cadastro_recusado', assunto: m.assunto, html: m.html, referenciaTipo: 'profissional', referenciaId: id });
  }
}

export const aprovarProfissional = (id: string, porId: string, ip: string | null = null) =>
  mudarStatus(id, 'aprovado', porId, null, ip);

export const recusarProfissional = (id: string, porId: string, motivo: string | null, ip: string | null = null) =>
  mudarStatus(id, 'recusado', porId, motivo, ip);

/** Bloqueado não reserva mais; as reservas futuras ficam para o Anfitrião decidir (A6). */
export const bloquearProfissional = (id: string, porId: string, motivo: string | null, ip: string | null = null) =>
  mudarStatus(id, 'bloqueado', porId, motivo, ip);

export const desbloquearProfissional = (id: string, porId: string, ip: string | null = null) =>
  mudarStatus(id, 'aprovado', porId, null, ip);

/** Quantos cadastros esperam decisão (alerta do Início e do menu). */
export async function contarPendentes(): Promise<number> {
  const [linha] = await db
    .select({ total: count() })
    .from(schema.profissional)
    .where(eq(schema.profissional.status, 'pendente'));
  return linha.total;
}
