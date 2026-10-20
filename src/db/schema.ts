import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
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
// as regras (restrições EXCLUDE na migração 'ocupacao_restricoes').
export const ocupacao = pgTable(
  'ocupacao',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    espacoId: uuid('espaco_id').notNull().references(() => espaco.id, { onDelete: 'cascade' }),
    periodo: tstzrange('periodo').notNull(),
    periodoComTrava: tstzrange('periodo_com_trava').notNull(),
    geraTrava: boolean('gera_trava').notNull(),
    ocupante: text('ocupante').notNull(), // 'prof:<id>' ou 'anfitriao'
    reservaId: uuid('reserva_id').unique().references(() => reserva.id, { onDelete: 'cascade' }),
    bloqueioId: uuid('bloqueio_id').unique().references(() => bloqueio.id, { onDelete: 'cascade' }),
  },
  (t) => [index('ocupacao_espaco_idx').on(t.espacoId)],
);

// ---------------------------------------------------------------------------
// E2: profissional, contrato e termo, reserva e cobrança (modelo-de-dados.md, seções 3.1, 3.3, 3.4 e 3.6)
// ---------------------------------------------------------------------------

// 1:1 com usuario. CPF e registro profissional são dados pessoais (LGPD): dados mínimos, sem upload.
export const profissional = pgTable('profissional', {
  usuarioId: text('usuario_id').primaryKey().references(() => usuario.id, { onDelete: 'cascade' }),
  cpf: text('cpf').notNull().unique(), // só dígitos
  profissao: text('profissao', { enum: ['psiquiatra', 'psicologo', 'terapeuta', 'outro'] }).notNull(),
  conselho: text('conselho', { enum: ['CRM', 'CRP', 'outro'] }).notNull(),
  registroNumero: text('registro_numero').notNull(),
  registroUf: text('registro_uf').notNull(),
  status: text('status', { enum: ['pendente', 'aprovado', 'recusado', 'bloqueado'] })
    .notNull()
    .default('pendente'),
  avaliadoPor: text('avaliado_por').references(() => usuario.id),
  avaliadoEm: timestamp('avaliado_em', { withTimezone: true }),
  motivoAvaliacao: text('motivo_avaliacao'),
  asaasClienteId: text('asaas_cliente_id'),
  criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
});

// Nunca se edita uma versão publicada; publica-se outra.
export const documentoLegal = pgTable(
  'documento_legal',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tipo: text('tipo', { enum: ['contrato', 'termo_reserva'] }).notNull(),
    versao: integer('versao').notNull(),
    texto: text('texto').notNull(),
    publicadoEm: timestamp('publicado_em', { withTimezone: true }).notNull().defaultNow(),
    publicadoPor: text('publicado_por').references(() => usuario.id),
  },
  (t) => [unique('documento_legal_tipo_versao_uq').on(t.tipo, t.versao)],
);

export const reserva = pgTable(
  'reserva',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    espacoId: uuid('espaco_id').notNull().references(() => espaco.id, { onDelete: 'cascade' }),
    profissionalId: text('profissional_id').notNull().references(() => profissional.usuarioId),
    serieId: uuid('serie_id'), // a tabela de séries chega na E5
    inicio: timestamp('inicio', { withTimezone: true }).notNull(),
    fim: timestamp('fim', { withTimezone: true }).notNull(),
    unidade: text('unidade', { enum: ['hora', 'turno', 'dia'] }).notNull(), // como foi pedida
    turnoId: uuid('turno_id').references(() => turno.id),
    // Preço calculado na hora do pedido: mudar a tabela de preços não altera reservas existentes.
    valorCheioCentavos: integer('valor_cheio_centavos').notNull(),
    descontoCentavos: integer('desconto_centavos').notNull().default(0),
    valorCentavos: integer('valor_centavos').notNull(),
    status: text('status', {
      enum: ['solicitada', 'aguardando_pagamento', 'confirmada', 'realizada', 'falta', 'recusada', 'expirada', 'cancelada'],
    })
      .notNull()
      .default('solicitada'),
    prazoAprovacaoAte: timestamp('prazo_aprovacao_ate', { withTimezone: true }),
    prazoPagamentoAte: timestamp('prazo_pagamento_ate', { withTimezone: true }),
    aprovadaPor: text('aprovada_por').references(() => usuario.id),
    aprovadaEm: timestamp('aprovada_em', { withTimezone: true }),
    motivoRecusa: text('motivo_recusa'),
    canceladaPor: text('cancelada_por').references(() => usuario.id),
    canceladaEm: timestamp('cancelada_em', { withTimezone: true }),
    creditoGeradoCentavos: integer('credito_gerado_centavos'),
    // Guardado até a reserva terminar (o Profissional vê na tela) e apagado depois pelo job horário.
    codigoAcesso: text('codigo_acesso'),
    codigoAcessoEnviadoPor: text('codigo_acesso_enviado_por').references(() => usuario.id),
    codigoAcessoEnviadoEm: timestamp('codigo_acesso_enviado_em', { withTimezone: true }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('reserva_fim_depois_inicio', sql`${t.fim} > ${t.inicio}`),
    check(
      'reserva_valores_validos',
      sql`${t.valorCentavos} >= 0 AND ${t.descontoCentavos} >= 0 AND ${t.valorCheioCentavos} >= ${t.valorCentavos}`,
    ),
    index('reserva_profissional_inicio_idx').on(t.profissionalId, t.inicio),
    index('reserva_espaco_status_idx').on(t.espacoId, t.status),
  ],
);

export const cobranca = pgTable(
  'cobranca',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profissionalId: text('profissional_id').notNull().references(() => profissional.usuarioId),
    finalidade: text('finalidade', { enum: ['reserva', 'pacote_mes', 'ocorrencia', 'compra_credito'] }).notNull(),
    valorBrutoCentavos: integer('valor_bruto_centavos').notNull(),
    descontoCentavos: integer('desconto_centavos').notNull().default(0),
    creditoUsadoCentavos: integer('credito_usado_centavos').notNull().default(0),
    valorCobradoCentavos: integer('valor_cobrado_centavos').notNull(),
    status: text('status', { enum: ['pendente', 'paga', 'expirada', 'cancelada', 'estornada'] })
      .notNull()
      .default('pendente'),
    // 'pix_manual': marcada como paga pelo Anfitrião (E2). Os demais meios chegam nas E3 e E4.
    meio: text('meio', { enum: ['pix', 'cartao', 'credito', 'pix_manual'] }),
    marcadaPagaPor: text('marcada_paga_por').references(() => usuario.id),
    asaasCobrancaId: text('asaas_cobranca_id').unique(),
    asaasLinkFatura: text('asaas_link_fatura'),
    pixCopiaCola: text('pix_copia_cola'),
    venceEm: timestamp('vence_em', { withTimezone: true }),
    pagoEm: timestamp('pago_em', { withTimezone: true }),
    criadoEm: timestamp('criado_em', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('cobranca_profissional_idx').on(t.profissionalId)],
);

export const cobrancaItem = pgTable(
  'cobranca_item',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cobrancaId: uuid('cobranca_id').notNull().references(() => cobranca.id, { onDelete: 'cascade' }),
    reservaId: uuid('reserva_id').references(() => reserva.id),
    pacoteCreditoId: uuid('pacote_credito_id'), // a tabela de pacotes chega na E4
    valorCentavos: integer('valor_centavos').notNull(),
  },
  (t) => [index('cobranca_item_cobranca_idx').on(t.cobrancaId), index('cobranca_item_reserva_idx').on(t.reservaId)],
);

// O aceite do contrato (no cadastro) e do termo (a cada reserva) fica registrado com data, hora,
// IP e a versão exata do texto aceito.
export const aceite = pgTable('aceite', {
  id: uuid('id').primaryKey().defaultRandom(),
  usuarioId: text('usuario_id').notNull().references(() => usuario.id),
  documentoId: uuid('documento_id').notNull().references(() => documentoLegal.id),
  aceitoEm: timestamp('aceito_em', { withTimezone: true }).notNull().defaultNow(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  reservaId: uuid('reserva_id').references(() => reserva.id),
  serieId: uuid('serie_id'),
});
