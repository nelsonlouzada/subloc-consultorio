import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Intervalo de tempo do Postgres. Texto no formato '[inicio,fim)' (ISO, UTC).
const tstzrange = customType<{ data: string; driverData: string }>({
  dataType: () => 'tstzrange',
});

// Tabelas da biblioteca de autenticação (Better Auth). As propriedades têm os nomes
// que a biblioteca espera; as colunas no banco seguem o português do modelo-de-dados.md.
export const usuario = pgTable('usuario', {
  id: text('id').primaryKey(),
  name: text('nome').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verificado').notNull().default(false),
  image: text('imagem'),
  telefone: text('telefone'),
  papel: text('papel', { enum: ['anfitriao', 'profissional'] }).notNull().default('profissional'),
  ativo: boolean('ativo').notNull().default(true),
  createdAt: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

export const sessao = pgTable('sessao', {
  id: text('id').primaryKey(),
  userId: text('usuario_id').notNull().references(() => usuario.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expira_em', { withTimezone: true }).notNull(),
  ipAddress: text('ip'),
  userAgent: text('user_agent'),
  createdAt: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

export const conta = pgTable('conta', {
  id: text('id').primaryKey(),
  userId: text('usuario_id').notNull().references(() => usuario.id, { onDelete: 'cascade' }),
  accountId: text('conta_id').notNull(),
  providerId: text('provedor_id').notNull(),
  password: text('senha_hash'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expira_em', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expira_em', { withTimezone: true }),
  scope: text('scope'),
  createdAt: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

export const verificacao = pgTable('verificacao', {
  id: text('id').primaryKey(),
  identifier: text('identificador').notNull(),
  value: text('valor').notNull(),
  expiresAt: timestamp('expira_em', { withTimezone: true }).notNull(),
  createdAt: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

// Responde "quem aprovou, cancelou ou deu crédito" (D7). usuario_id nulo = sistema.
export const eventoAuditoria = pgTable(
  'evento_auditoria',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    usuarioId: text('usuario_id').references(() => usuario.id),
    acao: text('acao').notNull(),
    entidade: text('entidade').notNull(),
    entidadeId: text('entidade_id'),
    dados: jsonb('dados'),
    ip: text('ip'),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('evento_auditoria_entidade_idx').on(t.entidade, t.entidadeId)],
);

// Garante que um aviso repetido do Asaas não é processado duas vezes (evento_id único).
export const webhookEvento = pgTable('webhook_evento', {
  id: uuid('id').primaryKey().defaultRandom(),
  provedor: text('provedor', { enum: ['asaas'] }).notNull(),
  eventoId: text('evento_id').notNull().unique(),
  tipo: text('tipo').notNull(),
  payload: jsonb('payload').notNull(),
  recebidoEm: timestamp('recebido_em', { withTimezone: true }).notNull().defaultNow(),
  processadoEm: timestamp('processado_em', { withTimezone: true }),
  erro: text('erro'),
});

// ---------------------------------------------------------------------------
// E1: espaço, regras, turnos, preços, bloqueios e ocupação (modelo-de-dados.md, seções 3.2 e 3.4-3.5)
// ---------------------------------------------------------------------------

export const espaco = pgTable('espaco', {
  id: uuid('id').primaryKey().defaultRandom(),
  nome: text('nome').notNull(),
  slug: text('slug').notNull().unique(),
  descricao: text('descricao'),
  logradouro: text('logradouro'),
  numero: text('numero'),
  complemento: text('complemento'),
  bairro: text('bairro'),
  cidade: text('cidade'),
  uf: text('uf'),
  cep: text('cep'),
  comodidades: text('comodidades').array().notNull().default([]),
  fuso: text('fuso').notNull().default('America/Sao_Paulo'),
  ativo: boolean('ativo').notNull().default(true),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

// Uma linha por espaço. Tudo que o Anfitrião pode ajustar sem mexer no código.
export const regraEspaco = pgTable('regra_espaco', {
  espacoId: uuid('espaco_id').primaryKey().references(() => espaco.id, { onDelete: 'cascade' }),
  diasFuncionamento: smallint('dias_funcionamento').array().notNull(), // 1 = segunda ... 7 = domingo
  abre: time('abre').notNull(),
  fecha: time('fecha').notNull(),
  antecedenciaMinHoras: integer('antecedencia_min_horas').notNull(),
  antecedenciaMaxDias: integer('antecedencia_max_dias').notNull(),
  duracaoMinHoras: integer('duracao_min_horas').notNull(),
  travaMinutos: integer('trava_minutos').notNull(),
  prazoAprovacaoHoras: integer('prazo_aprovacao_horas').notNull(),
  prazoPagamentoHoras: integer('prazo_pagamento_horas').notNull(),
  corteAntesInicioHoras: integer('corte_antes_inicio_horas').notNull(),
  validadeCreditoDias: integer('validade_credito_dias').notNull(),
  descontoPacoteMesPct: integer('desconto_pacote_mes_pct').notNull(),
  avisoRenovacaoSerieDias: integer('aviso_renovacao_serie_dias').notNull(),
  horaLembreteVespera: time('hora_lembrete_vespera').notNull(),
  atualizadoPor: text('atualizado_por').references(() => usuario.id),
  atualizadoEm: timestamp('atualizado_em', { withTimezone: true }).notNull().defaultNow(),
});

export const turno = pgTable('turno', {
  id: uuid('id').primaryKey().defaultRandom(),
  espacoId: uuid('espaco_id').notNull().references(() => espaco.id, { onDelete: 'cascade' }),
  nome: text('nome').notNull(),
  inicio: time('inicio').notNull(),
  fim: time('fim').notNull(),
  ordem: integer('ordem').notNull(),
  ativo: boolean('ativo').notNull().default(true),
});

// A reserva grava o valor calculado, então mudar o preço não altera reservas existentes.
export const preco = pgTable('preco', {
  id: uuid('id').primaryKey().defaultRandom(),
  espacoId: uuid('espaco_id').notNull().references(() => espaco.id, { onDelete: 'cascade' }),
  unidade: text('unidade', { enum: ['hora', 'turno', 'dia'] }).notNull(),
  turnoId: uuid('turno_id').references(() => turno.id, { onDelete: 'cascade' }), // só para unidade 'turno'
  valorCentavos: integer('valor_centavos').notNull(),
  vigenteDesde: timestamp('vigente_desde', { withTimezone: true }).notNull().defaultNow(),
});

export const bloqueio = pgTable(
  'bloqueio',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    espacoId: uuid('espaco_id').notNull().references(() => espaco.id, { onDelete: 'cascade' }),
    tipo: text('tipo', { enum: ['uso_proprio', 'indisponivel'] }).notNull(),
    inicio: timestamp('inicio', { withTimezone: true }).notNull(),
    fim: timestamp('fim', { withTimezone: true }).notNull(),
    motivo: text('motivo'),
    grupoId: uuid('grupo_id'), // bloqueios criados juntos por repetição
    criadoPor: text('criado_por').notNull().references(() => usuario.id),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('bloqueio_espaco_inicio_idx').on(t.espacoId, t.inicio), index('bloqueio_grupo_idx').on(t.grupoId)],
);

// Reservas e bloqueios disputam o mesmo tempo; esta tabela junta os dois e o BANCO garante
// as regras (restrições EXCLUDE na migração 'ocupacao_restricoes'). reserva_id ganha a chave
// estrangeira na E2, quando a tabela de reservas existir.
export const ocupacao = pgTable(
  'ocupacao',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    espacoId: uuid('espaco_id').notNull().references(() => espaco.id, { onDelete: 'cascade' }),
    periodo: tstzrange('periodo').notNull(),
    periodoComTrava: tstzrange('periodo_com_trava').notNull(),
    geraTrava: boolean('gera_trava').notNull(),
    ocupante: text('ocupante').notNull(), // 'prof:<id>' ou 'anfitriao'
    reservaId: uuid('reserva_id').unique(),
    bloqueioId: uuid('bloqueio_id').unique().references(() => bloqueio.id, { onDelete: 'cascade' }),
  },
  (t) => [index('ocupacao_espaco_idx').on(t.espacoId)],
);
