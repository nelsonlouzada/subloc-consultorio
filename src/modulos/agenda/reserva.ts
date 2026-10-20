import { and, count, desc, eq, gt, inArray, lt } from 'drizzle-orm';
import { db, schema } from '@/db';
import { partesLocais } from '@/lib/fuso';
import { registrarAuditoria } from '@/modulos/auditoria/auditoria';
import { emailNovaSolicitacao } from '@/modulos/comunicacao/modelos';
import { anfitrioesAtivos, notificar } from '@/modulos/comunicacao/notificar';
import { documentoVigente } from '@/modulos/configuracao/documentos-iniciais';
import { carregarTabelaPrecos } from '@/modulos/configuracao/precos';
import { descreverPeriodo } from './calendario';
import { carregarOcupacoes, type MotivoIndisponivel, type Regras, validarPedido } from './disponibilidade';
import { ConflitoAgendaError, registrarOcupacao } from './ocupacao';
import { type CalculoPreco, calcularPreco } from './preco';

/**
 * Teto de pedidos em aberto (solicitada ou aguardando pagamento) por Profissional. Um pedido
 * retém o horário e gera trava para os outros, e o cadastro é aberto: sem um teto, uma conta
 * ainda não aprovada poderia reservar a agenda inteira. Decisão de produto a confirmar.
 */
export const MAX_PEDIDOS_ABERTOS = 5;

const HORA_MS = 3_600_000;

export type PedidoReserva = {
  espacoId: string;
  profissionalId: string;
  inicio: Date;
  fim: Date;
  unidade: 'hora' | 'turno' | 'dia';
  /** Obrigatório quando a unidade é 'turno'. */
  turnoId?: string | null;
  /** "Usar crédito" (D8): ligado por padrão. */
  usarCredito?: boolean;
};

export type ErroReserva =
  | MotivoIndisponivel
  | 'sem_regras'
  | 'sem_termo'
  | 'profissional_nao_pode'
  | 'limite_pedidos'
  | 'unidade_invalida';

export type ResultadoReserva =
  | { ok: true; reservaId: string; valorCentavos: number }
  | { ok: false; erro: ErroReserva };

export const TEXTO_ERRO_RESERVA: Record<ErroReserva, string> = {
  horas_cheias: 'A reserva é em horas cheias.',
  duracao_minima: 'Abaixo da duração mínima.',
  fechado: 'A sala não abre neste dia.',
  fora_do_horario: 'Fora do horário de funcionamento.',
  antecedencia_minima: 'Este horário está muito próximo. Reservas precisam de pelo menos 24 horas de antecedência.',
  antecedencia_maxima: 'Este horário está longe demais. Ainda não aceitamos reservas para esta data.',
  ocupado: 'Este horário acabou de ser ocupado. Escolha outro.',
  trava: 'Este horário fica na hora de intervalo de outra reserva. Escolha outro.',
  sem_regras: 'A sala ainda não está configurada.',
  sem_termo: 'O termo de reserva ainda não está disponível.',
  profissional_nao_pode: 'Seu cadastro não pode fazer reservas no momento.',
  limite_pedidos: `Você já tem ${MAX_PEDIDOS_ABERTOS} pedidos em aberto. Aguarde a resposta deles para pedir outros.`,
  unidade_invalida: 'Os dados do pedido não conferem. Escolha o horário de novo.',
};

const horaDe = (t: string) => Number(t.slice(0, 2));

export type PedidoAvaliado = {
  regras: Regras;
  profissionalNome: string;
  termo: { id: string; versao: number; texto: string };
  preco: CalculoPreco;
  prazoAprovacaoAte: Date;
};

/**
 * Confere um pedido sem gravar nada: status do Profissional, unidade, teto de pedidos, regras
 * da sala, ocupação, preço e prazo. A tela de resumo usa esta função para mostrar o preço antes
 * de enviar, e a criação usa a mesma, para os dois nunca divergirem.
 */
export async function avaliarPedido(
  pedido: PedidoReserva,
  agora = new Date(),
): Promise<{ ok: true; avaliado: PedidoAvaliado } | { ok: false; erro: ErroReserva }> {
  const falha = (erro: ErroReserva) => ({ ok: false as const, erro });

  const [regras] = await db.select().from(schema.regraEspaco).where(eq(schema.regraEspaco.espacoId, pedido.espacoId));
  if (!regras) return falha('sem_regras');

  const [prof] = await db
    .select({ status: schema.profissional.status, nome: schema.usuario.name })
    .from(schema.profissional)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.profissional.usuarioId))
    .where(eq(schema.profissional.usuarioId, pedido.profissionalId));
  // O pendente já pode pedir (D2); recusado e bloqueado, não.
  if (!prof || (prof.status !== 'pendente' && prof.status !== 'aprovado')) return falha('profissional_nao_pode');

  // A unidade pedida precisa bater com o horário (um "turno" é exatamente o turno).
  const pIni = partesLocais(pedido.inicio);
  const horas = (pedido.fim.getTime() - pedido.inicio.getTime()) / HORA_MS;
  if (pedido.unidade === 'turno') {
    const [t] = pedido.turnoId
      ? await db
          .select()
          .from(schema.turno)
          .where(and(eq(schema.turno.id, pedido.turnoId), eq(schema.turno.espacoId, pedido.espacoId), eq(schema.turno.ativo, true)))
      : [];
    if (!t || horaDe(t.inicio) !== pIni.hora || horaDe(t.fim) - horaDe(t.inicio) !== horas) return falha('unidade_invalida');
  } else if (pedido.unidade === 'dia') {
    if (horaDe(regras.abre) !== pIni.hora || horaDe(regras.fecha) - horaDe(regras.abre) !== horas) return falha('unidade_invalida');
  }

  const [{ abertos }] = await db
    .select({ abertos: count() })
    .from(schema.reserva)
    .where(
      and(
        eq(schema.reserva.profissionalId, pedido.profissionalId),
        inArray(schema.reserva.status, ['solicitada', 'aguardando_pagamento']),
        gt(schema.reserva.fim, agora),
      ),
    );
  if (abertos >= MAX_PEDIDOS_ABERTOS) return falha('limite_pedidos');

  const ocupacoes = await carregarOcupacoes(
    pedido.espacoId,
    new Date(pedido.inicio.getTime() - 24 * HORA_MS),
    new Date(pedido.fim.getTime() + 24 * HORA_MS),
  );
  const motivo = validarPedido(regras, ocupacoes, `prof:${pedido.profissionalId}`, pedido.inicio, pedido.fim, agora);
  if (motivo) return falha(motivo);

  const termo = await documentoVigente('termo_reserva');
  if (!termo) return falha('sem_termo');

  const preco = calcularPreco(pedido.inicio, pedido.fim, await carregarTabelaPrecos(pedido.espacoId));

  // Prazos encadeados (D3): aprovação em até N horas, mas nunca depois do corte antes do início.
  const prazoAprovacaoAte = new Date(
    Math.min(
      agora.getTime() + regras.prazoAprovacaoHoras * HORA_MS,
      pedido.inicio.getTime() - regras.corteAntesInicioHoras * HORA_MS,
    ),
  );

  return {
    ok: true,
    avaliado: {
      regras,
      profissionalNome: prof.nome,
      termo: { id: termo.id, versao: termo.versao, texto: termo.texto },
      preco,
      prazoAprovacaoAte,
    },
  };
}

/**
 * Cria um pedido de reserva: confere as regras, retém o horário e registra o aceite do termo,
 * tudo numa transação. Se outro pedido chegar ao mesmo horário no mesmo instante, o banco
 * recusa um deles e nada fica gravado.
 */
export async function criarReserva(
  pedido: PedidoReserva,
  contexto: { ip: string | null; userAgent: string | null },
  agora = new Date(),
): Promise<ResultadoReserva> {
  const r = await avaliarPedido(pedido, agora);
  if (!r.ok) return r;
  const { regras, preco, termo, prazoAprovacaoAte, profissionalNome } = r.avaliado;

  let reservaId: string;
  try {
    reservaId = await db.transaction(async (tx) => {
      const [nova] = await tx
        .insert(schema.reserva)
        .values({
          espacoId: pedido.espacoId,
          profissionalId: pedido.profissionalId,
          inicio: pedido.inicio,
          fim: pedido.fim,
          unidade: pedido.unidade,
          turnoId: pedido.unidade === 'turno' ? pedido.turnoId : null,
          valorCheioCentavos: preco.valorCentavos,
          descontoCentavos: 0,
          valorCentavos: preco.valorCentavos,
          usarCredito: pedido.usarCredito ?? true,
          prazoAprovacaoAte,
        })
        .returning({ id: schema.reserva.id });
      await registrarOcupacao(tx, {
        espacoId: pedido.espacoId,
        inicio: pedido.inicio,
        fim: pedido.fim,
        ocupante: `prof:${pedido.profissionalId}`,
        geraTrava: true,
        travaMinutos: regras.travaMinutos,
        reservaId: nova.id,
      });
      await tx.insert(schema.aceite).values({
        usuarioId: pedido.profissionalId,
        documentoId: termo.id,
        ip: contexto.ip,
        userAgent: contexto.userAgent,
        reservaId: nova.id,
      });
      return nova.id;
    });
  } catch (e) {
    if (e instanceof ConflitoAgendaError) return { ok: false, erro: e.motivo === 'sobreposicao' ? 'ocupado' : 'trava' };
    throw e;
  }

  await registrarAuditoria({
    usuarioId: pedido.profissionalId,
    acao: 'reserva_solicitada',
    entidade: 'reserva',
    entidadeId: reservaId,
    dados: { unidade: pedido.unidade, valorCentavos: preco.valorCentavos },
    ip: contexto.ip,
  });

  const modelo = emailNovaSolicitacao({
    nome: profissionalNome,
    periodo: descreverPeriodo(pedido.inicio, pedido.fim),
    valor: (preco.valorCentavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
  });
  for (const a of await anfitrioesAtivos()) {
    await notificar({
      usuarioId: a.id,
      para: a.email,
      tipo: 'nova_solicitacao',
      assunto: modelo.assunto,
      html: modelo.html,
      referenciaTipo: 'reserva',
      referenciaId: reservaId,
    });
  }

  return { ok: true, reservaId, valorCentavos: preco.valorCentavos };
}

/** Reservas que aparecem na agenda do Anfitrião num período [de, ate): as que ocupam a sala e as já realizadas. */
export async function listarReservasNoPeriodo(espacoId: string, de: Date, ate: Date) {
  return db
    .select({
      id: schema.reserva.id,
      status: schema.reserva.status,
      inicio: schema.reserva.inicio,
      fim: schema.reserva.fim,
      valorCentavos: schema.reserva.valorCentavos,
      profissional: schema.usuario.name,
    })
    .from(schema.reserva)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.reserva.profissionalId))
    .where(
      and(
        eq(schema.reserva.espacoId, espacoId),
        inArray(schema.reserva.status, ['solicitada', 'aguardando_pagamento', 'confirmada', 'realizada', 'falta']),
        lt(schema.reserva.inicio, ate),
        gt(schema.reserva.fim, de),
      ),
    )
    .orderBy(schema.reserva.inicio);
}

/** Pedidos e reservas do Profissional, dos mais recentes para os mais antigos. */
export async function listarReservasDoProfissional(profissionalId: string) {
  return db
    .select()
    .from(schema.reserva)
    .where(eq(schema.reserva.profissionalId, profissionalId))
    .orderBy(desc(schema.reserva.inicio));
}
