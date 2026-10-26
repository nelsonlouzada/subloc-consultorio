import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { type DataLocal, diaSemanaDe, formatarDataISO, instanteLocal, somarDias } from '@/lib/fuso';
import { formatarReais } from '@/lib/dinheiro';
import { registrarAuditoria } from '@/modulos/auditoria/auditoria';
import { emailNovaSerie } from '@/modulos/comunicacao/modelos';
import { anfitrioesAtivos, notificar } from '@/modulos/comunicacao/notificar';
import { documentoVigente } from '@/modulos/configuracao/documentos-iniciais';
import { horaInteira } from '@/modulos/configuracao/espaco';
import { carregarTabelaPrecos } from '@/modulos/configuracao/precos';
import { hojeLocal, segundaDaSemana } from './calendario';
import { carregarOcupacoes, type MotivoIndisponivel, type Regras, validarPedido } from './disponibilidade';
import { ConflitoAgendaError, registrarOcupacao } from './ocupacao';
import { calcularPreco } from './preco';
import { contarPedidosAbertos, MAX_PEDIDOS_ABERTOS } from './reserva';

/** Teto de datas por série: uma série cobre no máximo 60 dias (D4), então 26 já é mais que três dias por semana. */
export const MAX_OCORRENCIAS = 26;

const HORA_MS = 3_600_000;

export type PedidoSerie = {
  espacoId: string;
  profissionalId: string;
  /** 1 = segunda ... 7 = domingo. */
  diasSemana: number[];
  frequencia: 'semanal' | 'quinzenal';
  unidade: 'hora' | 'turno' | 'dia';
  turnoId?: string | null;
  /** Só para a unidade 'hora': horas cheias locais, de 0 a 24. */
  horaInicio?: number | null;
  horaFim?: number | null;
  dataInicio: DataLocal;
  dataFim: DataLocal;
  formaPagamento: 'pacote_mes' | 'por_ocorrencia';
};

export type ErroSerie =
  | 'sem_regras'
  | 'sem_termo'
  | 'profissional_nao_pode'
  | 'limite_pedidos'
  | 'unidade_invalida'
  | 'dias_invalidos'
  | 'periodo_invalido'
  | 'periodo_longe'
  | 'muitas_ocorrencias'
  | 'sem_ocorrencias_validas'
  | 'ocupado';

export const TEXTO_ERRO_SERIE: Record<ErroSerie, string> = {
  sem_regras: 'A sala ainda não está configurada.',
  sem_termo: 'O termo de reserva ainda não está disponível.',
  profissional_nao_pode: 'Seu cadastro não pode fazer reservas no momento.',
  limite_pedidos: `Você já tem ${MAX_PEDIDOS_ABERTOS} pedidos em aberto. Aguarde a resposta deles para pedir outros.`,
  unidade_invalida: 'Os dados do horário não conferem. Escolha de novo.',
  dias_invalidos: 'Escolha pelo menos um dia da semana.',
  periodo_invalido: 'O período é inválido: a data final não pode ser antes da inicial, nem a inicial ser passada.',
  periodo_longe: 'A série pode ir até 60 dias à frente. Escolha uma data final mais próxima (depois você renova).',
  muitas_ocorrencias: `A série tem datas demais (máximo de ${MAX_OCORRENCIAS}). Reduza os dias ou o período.`,
  sem_ocorrencias_validas: 'Nenhuma das datas está disponível. Ajuste os dias, o horário ou o período.',
  ocupado: 'Alguma das datas acabou de ser ocupada. Revise a série e envie de novo.',
};

/** Segundas-feiras são o começo da semana; "quinzenal" é uma semana sim, uma não, contando da semana da data inicial. */
function diasEntre(a: DataLocal, b: DataLocal): number {
  return Math.round((Date.UTC(b.ano, b.mes - 1, b.dia) - Date.UTC(a.ano, a.mes - 1, a.dia)) / 86_400_000);
}

/** Todas as datas de [inicio, fim] que caem nos dias da semana pedidos (semanal ou quinzenal). Pura e testada. */
export function expandirDatas(inicio: DataLocal, fim: DataLocal, diasSemana: number[], frequencia: 'semanal' | 'quinzenal'): DataLocal[] {
  const ate = formatarDataISO(fim);
  const segundaInicial = segundaDaSemana(inicio);
  const datas: DataLocal[] = [];
  // Trava de segurança: nenhuma série legítima passa de ~70 dias; evita laço enorme com data final absurda.
  for (let d = inicio, n = 0; formatarDataISO(d) <= ate && n < 400; d = somarDias(d, 1), n++) {
    if (!diasSemana.includes(diaSemanaDe(d))) continue;
    if (frequencia === 'quinzenal' && (diasEntre(segundaInicial, segundaDaSemana(d)) / 7) % 2 !== 0) continue;
    datas.push(d);
  }
  return datas;
}

export type OcorrenciaAvaliada = {
  data: DataLocal;
  inicio: Date;
  fim: Date;
  valorCheioCentavos: number;
  descontoCentavos: number;
  valorCentavos: number;
  /** null = disponível; senão, por que esta data fica de fora. */
  motivo: MotivoIndisponivel | null;
};

export type SerieAvaliada = {
  regras: Regras;
  profissionalNome: string;
  termo: { id: string; versao: number; texto: string };
  horario: { de: number; ate: number; turnoId: string | null };
  descontoPct: number;
  ocorrencias: OcorrenciaAvaliada[];
  validas: OcorrenciaAvaliada[];
  /** Soma do que a série custa, só das datas disponíveis, já com o desconto do pacote do mês. */
  totalCentavos: number;
  prazoAprovacaoAte: Date;
};

async function horarioDoPedido(p: PedidoSerie, regras: Regras): Promise<{ de: number; ate: number; turnoId: string | null } | null> {
  if (p.unidade === 'dia') return { de: horaInteira(regras.abre), ate: horaInteira(regras.fecha), turnoId: null };
  if (p.unidade === 'turno') {
    if (!p.turnoId) return null;
    const [t] = await db
      .select()
      .from(schema.turno)
      .where(and(eq(schema.turno.id, p.turnoId), eq(schema.turno.espacoId, p.espacoId), eq(schema.turno.ativo, true)))
      .catch(() => []);
    return t ? { de: horaInteira(t.inicio), ate: horaInteira(t.fim), turnoId: t.id } : null;
  }
  const { horaInicio: de, horaFim: ate } = p;
  if (de == null || ate == null || !Number.isInteger(de) || !Number.isInteger(ate) || de < 0 || ate > 24 || ate <= de) return null;
  return { de, ate, turnoId: null };
}

/**
 * Confere uma série sem gravar nada: cadastro, horário, período (até 60 dias à frente, D4), teto
 * de pedidos, e cada data contra as regras da sala e a ocupação. As datas indisponíveis aparecem
 * com o motivo e ficam fora da série; o preço é o menor possível por data, com o desconto do
 * pacote do mês quando for o caso. A tela de resumo e a criação usam a mesma função.
 */
export async function avaliarSerie(
  pedido: PedidoSerie,
  agora = new Date(),
): Promise<{ ok: true; avaliada: SerieAvaliada } | { ok: false; erro: ErroSerie }> {
  const falha = (erro: ErroSerie) => ({ ok: false as const, erro });

  const [regras] = await db.select().from(schema.regraEspaco).where(eq(schema.regraEspaco.espacoId, pedido.espacoId));
  if (!regras) return falha('sem_regras');
  const [prof] = await db
    .select({ status: schema.profissional.status, nome: schema.usuario.name })
    .from(schema.profissional)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.profissional.usuarioId))
    .where(eq(schema.profissional.usuarioId, pedido.profissionalId));
  if (!prof || (prof.status !== 'pendente' && prof.status !== 'aprovado')) return falha('profissional_nao_pode');

  const dias = [...new Set(pedido.diasSemana)].filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  if (dias.length === 0) return falha('dias_invalidos');
  const horario = await horarioDoPedido(pedido, regras);
  if (!horario) return falha('unidade_invalida');

  const hoje = hojeLocal(agora);
  const ini = formatarDataISO(pedido.dataInicio);
  const fim = formatarDataISO(pedido.dataFim);
  if (fim < ini || ini < formatarDataISO(hoje)) return falha('periodo_invalido');
  if (diasEntre(hoje, pedido.dataFim) > regras.antecedenciaMaxDias) return falha('periodo_longe');

  const datas = expandirDatas(pedido.dataInicio, pedido.dataFim, dias, pedido.frequencia);
  if (datas.length > MAX_OCORRENCIAS) return falha('muitas_ocorrencias');
  if (datas.length === 0) return falha('sem_ocorrencias_validas');

  if ((await contarPedidosAbertos(pedido.profissionalId, agora)) >= MAX_PEDIDOS_ABERTOS) return falha('limite_pedidos');
  const termo = await documentoVigente('termo_reserva');
  if (!termo) return falha('sem_termo');

  const tabela = await carregarTabelaPrecos(pedido.espacoId);
  const em = (d: DataLocal, h: number) => instanteLocal(d.ano, d.mes, d.dia, h);
  const janelaDe = new Date(em(datas[0], horario.de).getTime() - 24 * HORA_MS);
  const janelaAte = new Date(em(datas[datas.length - 1], horario.ate).getTime() + 24 * HORA_MS);
  const ocupacoes = await carregarOcupacoes(pedido.espacoId, janelaDe, janelaAte);
  const descontoPct = pedido.formaPagamento === 'pacote_mes' ? regras.descontoPacoteMesPct : 0;

  const ocorrencias: OcorrenciaAvaliada[] = datas.map((data) => {
    const inicio = em(data, horario.de);
    const fimOc = em(data, horario.ate);
    const preco = calcularPreco(inicio, fimOc, tabela).valorCentavos;
    const desconto = Math.floor((preco * descontoPct) / 100);
    return {
      data,
      inicio,
      fim: fimOc,
      valorCheioCentavos: preco,
      descontoCentavos: desconto,
      valorCentavos: preco - desconto,
      motivo: validarPedido(regras, ocupacoes, `prof:${pedido.profissionalId}`, inicio, fimOc, agora),
    };
  });
  const validas = ocorrencias.filter((o) => o.motivo === null);
  if (validas.length === 0) return falha('sem_ocorrencias_validas');

  // Prazo de aprovação da série inteira (D3): o mesmo para todas, medido pela primeira data.
  const prazoAprovacaoAte = new Date(
    Math.min(agora.getTime() + regras.prazoAprovacaoHoras * HORA_MS, validas[0].inicio.getTime() - regras.corteAntesInicioHoras * HORA_MS),
  );
  return {
    ok: true,
    avaliada: {
      regras,
      profissionalNome: prof.nome,
      termo: { id: termo.id, versao: termo.versao, texto: termo.texto },
      horario,
      descontoPct,
      ocorrencias,
      validas,
      totalCentavos: validas.reduce((s, o) => s + o.valorCentavos, 0),
      prazoAprovacaoAte,
    },
  };
}

const DIAS_LONGOS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

/** 'toda terça e quinta, 09:00 às 10:00, de 03/11 a 30/11' (ou 'a cada duas semanas'). */
export function descreverSerie(s: { diasSemana: number[]; frequencia: 'semanal' | 'quinzenal'; horaInicio: number; horaFim: number; dataInicio: string; dataFim: string }): string {
  const nomes = [...s.diasSemana].sort((a, b) => a - b).map((d) => DIAS_LONGOS[d - 1]);
  const lista = nomes.length > 1 ? `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}` : nomes[0];
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
  const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  return `${s.frequencia === 'semanal' ? 'toda' : 'a cada duas semanas, '} ${lista}, ${hh(s.horaInicio)} às ${hh(s.horaFim)}, de ${br(s.dataInicio)} a ${br(s.dataFim)}`.replace('  ', ' ');
}

export type ResultadoSerie =
  | { ok: true; serieId: string; ocorrencias: number; ignoradas: OcorrenciaAvaliada[]; totalCentavos: number }
  | { ok: false; erro: ErroSerie };

/**
 * Cria o pedido de série: uma reserva `solicitada` por data disponível, todas retendo o horário,
 * mais o aceite do termo, numa transação única. Se qualquer data for ocupada por outra pessoa no
 * mesmo instante, o banco recusa e nada fica gravado. Os Anfitriões são avisados.
 */
export async function criarSerie(
  pedido: PedidoSerie,
  contexto: { ip: string | null; userAgent: string | null },
  agora = new Date(),
  opcoes: { usarCredito?: boolean; renovacaoDeId?: string | null } = {},
): Promise<ResultadoSerie> {
  const r = await avaliarSerie(pedido, agora);
  if (!r.ok) return r;
  const { regras, profissionalNome, termo, horario, validas, ocorrencias, prazoAprovacaoAte, totalCentavos } = r.avaliada;

  let serieId: string;
  try {
    serieId = await db.transaction(async (tx) => {
      const [nova] = await tx
        .insert(schema.serie)
        .values({
          espacoId: pedido.espacoId,
          profissionalId: pedido.profissionalId,
          diasSemana: [...new Set(pedido.diasSemana)].sort((a, b) => a - b),
          frequencia: pedido.frequencia,
          unidade: pedido.unidade,
          turnoId: horario.turnoId,
          horaInicio: pedido.unidade === 'hora' ? horario.de : null,
          horaFim: pedido.unidade === 'hora' ? horario.ate : null,
          dataInicio: formatarDataISO(pedido.dataInicio),
          dataFim: formatarDataISO(pedido.dataFim),
          formaPagamento: pedido.formaPagamento,
          renovacaoDeId: opcoes.renovacaoDeId ?? null,
        })
        .returning({ id: schema.serie.id });
      for (const o of validas) {
        const [reserva] = await tx
          .insert(schema.reserva)
          .values({
            espacoId: pedido.espacoId,
            profissionalId: pedido.profissionalId,
            serieId: nova.id,
            inicio: o.inicio,
            fim: o.fim,
            unidade: pedido.unidade,
            turnoId: horario.turnoId,
            valorCheioCentavos: o.valorCheioCentavos,
            descontoCentavos: o.descontoCentavos,
            valorCentavos: o.valorCentavos,
            usarCredito: opcoes.usarCredito ?? true,
            prazoAprovacaoAte,
          })
          .returning({ id: schema.reserva.id });
        await registrarOcupacao(tx, {
          espacoId: pedido.espacoId,
          inicio: o.inicio,
          fim: o.fim,
          ocupante: `prof:${pedido.profissionalId}`,
          geraTrava: true,
          travaMinutos: regras.travaMinutos,
          reservaId: reserva.id,
        });
      }
      await tx.insert(schema.aceite).values({
        usuarioId: pedido.profissionalId,
        documentoId: termo.id,
        ip: contexto.ip,
        userAgent: contexto.userAgent,
        serieId: nova.id,
      });
      return nova.id;
    });
  } catch (e) {
    if (e instanceof ConflitoAgendaError) return { ok: false, erro: 'ocupado' };
    throw e;
  }

  await registrarAuditoria({
    usuarioId: pedido.profissionalId,
    acao: 'serie_solicitada',
    entidade: 'serie',
    entidadeId: serieId,
    dados: { ocorrencias: validas.length, ignoradas: ocorrencias.length - validas.length, formaPagamento: pedido.formaPagamento, totalCentavos },
    ip: contexto.ip,
  });

  const modelo = emailNovaSerie({
    nome: profissionalNome,
    resumo: descreverSerie({
      diasSemana: pedido.diasSemana,
      frequencia: pedido.frequencia,
      horaInicio: horario.de,
      horaFim: horario.ate,
      dataInicio: formatarDataISO(pedido.dataInicio),
      dataFim: formatarDataISO(pedido.dataFim),
    }),
    ocorrencias: validas.length,
    total: formatarReais(totalCentavos),
    pacote: pedido.formaPagamento === 'pacote_mes',
  });
  for (const a of await anfitrioesAtivos()) {
    await notificar({
      usuarioId: a.id,
      para: a.email,
      tipo: 'nova_serie',
      assunto: modelo.assunto,
      html: modelo.html,
      referenciaTipo: 'serie',
      referenciaId: serieId,
    });
  }
  return { ok: true, serieId, ocorrencias: validas.length, ignoradas: ocorrencias.filter((o) => o.motivo !== null), totalCentavos };
}

