import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
