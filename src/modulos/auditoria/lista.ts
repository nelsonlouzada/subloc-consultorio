import { and, count, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';

/** Tela de auditoria (T23): quem fez o quê, em ordem, com filtros. Só leitura. */

export const NOME_ACAO: Record<string, string> = {
  cadastro_profissional: 'Cadastro de profissional',
  profissional_aprovado: 'Cadastro aprovado',
  profissional_recusado: 'Cadastro recusado',
  profissional_bloqueado: 'Profissional bloqueado',
  acesso_desativado: 'Acesso desativado',
  acesso_reativado: 'Acesso reativado',
  credito_manual: 'Crédito concedido',
  reserva_solicitada: 'Reserva pedida',
  reserva_aprovada: 'Reserva aprovada',
  reserva_recusada: 'Reserva recusada',
  reserva_cancelada: 'Reserva cancelada',
  reserva_cancelada_profissional: 'Reserva cancelada pelo profissional',
  reserva_expirada_aprovacao: 'Reserva expirou sem aprovação',
  reserva_expirada_pagamento: 'Reserva expirou sem pagamento',
  pagamento_marcado: 'Pagamento marcado como recebido',
  pagamento_marcado_apos_expirar: 'Pagamento marcado depois de expirar',
  pagamento_atrasado_virou_credito: 'Pagamento atrasado virou crédito',
  pagamento_sem_reserva_virou_credito: 'Pagamento sem reserva virou crédito',
  pagamento_serie_marcado: 'Pagamento da série marcado como recebido',
  pagamento_serie_atrasado: 'Pagamento atrasado da série',
  codigo_acesso_enviado: 'Código de acesso enviado',
  falta_registrada: 'Falta registrada',
  falta_desfeita: 'Falta desfeita',
  serie_solicitada: 'Série pedida',
  serie_aprovada: 'Série aprovada',
  serie_recusada: 'Série recusada',
  serie_cancelada: 'Série cancelada',
  serie_cancelada_profissional: 'Série cancelada pelo profissional',
  cobranca_serie_gerada: 'Cobrança de série gerada',
  compra_credito_iniciada: 'Compra de crédito iniciada',
  compra_credito_paga: 'Compra de crédito paga',
  regras_alteradas: 'Regras alteradas',
  precos_alterados: 'Preços alterados',
  turnos_alterados: 'Turnos alterados',
  sala_alterada: 'Dados da sala alterados',
  documento_publicado: 'Documento publicado',
  relatorio_exportado: 'Relatório exportado',
};

export const NOME_ENTIDADE: Record<string, string> = {
  reserva: 'Reserva',
  profissional: 'Profissional',
  serie: 'Série',
  espaco: 'Sala',
  documento_legal: 'Documento',
  financeiro: 'Financeiro',
  cobranca: 'Cobrança',
};

/** Ação sem nome cadastrado aparece legível mesmo assim: 'algo_novo' -> 'Algo novo'. */
export function nomeDaAcao(acao: string): string {
  if (NOME_ACAO[acao]) return NOME_ACAO[acao];
  const texto = acao.replace(/_/g, ' ').trim();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Para onde levar quem clica no registro. Só entidades que têm tela; o id vai codificado. */
export function linkDaEntidade(entidade: string, entidadeId: string | null): string | null {
  const id = entidadeId ? encodeURIComponent(entidadeId) : null;
  switch (entidade) {
    case 'reserva':
      return id ? `/reservas/${id}` : null;
    case 'profissional':
      return id ? `/profissionais/${id}` : null;
    case 'serie':
      return id ? `/series-da-sala/${id}` : null;
    case 'espaco':
      return '/configuracoes';
    case 'documento_legal':
      return '/configuracoes/documentos';
    case 'financeiro':
      return '/financeiro';
    default:
      return null;
  }
}

const SENSIVEL = /senha|token|codigo|cpf|chave|secret|segredo|cartao|authorization/i;

/**
 * Resumo curto dos dados de um evento, para a lista. Campos com cara de segredo viram "•••" mesmo
 * que alguém os tenha gravado por engano, e o texto é cortado: o detalhe completo fica no registro.
 */
export function resumirDados(dados: unknown, maximo = 140): string {
  if (dados === null || dados === undefined) return '';
  const limpar = (v: unknown, chave = ''): unknown => {
    if (SENSIVEL.test(chave)) return '•••';
    if (Array.isArray(v)) return v.map((x) => limpar(x));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, limpar(x, k)]));
    return v;
  };
  const texto = JSON.stringify(limpar(dados));
  if (!texto || texto === '{}') return '';
  return texto.length > maximo ? `${texto.slice(0, maximo - 1)}…` : texto;
}

export const POR_PAGINA = 50;

export type FiltroAuditoria = { acao?: string; entidade?: string; pagina?: number };

export async function listarEventos(filtro: FiltroAuditoria = {}) {
  const condicoes = [
    ...(filtro.acao ? [eq(schema.eventoAuditoria.acao, filtro.acao)] : []),
    ...(filtro.entidade ? [eq(schema.eventoAuditoria.entidade, filtro.entidade)] : []),
  ];
  const onde = condicoes.length ? and(...condicoes) : undefined;

  const [{ total }] = await db.select({ total: count() }).from(schema.eventoAuditoria).where(onde);
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const pagina = Math.min(Math.max(1, Math.trunc(filtro.pagina ?? 1) || 1), paginas);

  const linhas = await db
    .select({
      id: schema.eventoAuditoria.id,
      quando: schema.eventoAuditoria.criadoEm,
      acao: schema.eventoAuditoria.acao,
      entidade: schema.eventoAuditoria.entidade,
      entidadeId: schema.eventoAuditoria.entidadeId,
      dados: schema.eventoAuditoria.dados,
      ip: schema.eventoAuditoria.ip,
      quem: schema.usuario.name,
    })
    .from(schema.eventoAuditoria)
    .leftJoin(schema.usuario, eq(schema.usuario.id, schema.eventoAuditoria.usuarioId))
    .where(onde)
    .orderBy(desc(schema.eventoAuditoria.criadoEm), desc(schema.eventoAuditoria.id))
    .limit(POR_PAGINA)
    .offset((pagina - 1) * POR_PAGINA);

  return { linhas, total, pagina, paginas };
}

/** Ações e entidades que já aconteceram, para os filtros da tela. */
export async function opcoesDeFiltro() {
  const [acoes, entidades] = await Promise.all([
    db.selectDistinct({ valor: schema.eventoAuditoria.acao }).from(schema.eventoAuditoria).orderBy(schema.eventoAuditoria.acao),
    db.selectDistinct({ valor: schema.eventoAuditoria.entidade }).from(schema.eventoAuditoria).orderBy(schema.eventoAuditoria.entidade),
  ]);
  return { acoes: acoes.map((a) => a.valor), entidades: entidades.map((e) => e.valor) };
}
