import { and, eq, inArray, not } from 'drizzle-orm';
import { db, schema } from '@/db';
import { type DataLocal, diaSemanaDe, formatarDataISO, parseDataISO, somarDias } from '@/lib/fuso';
import { emailSerieRenovar } from '@/modulos/comunicacao/modelos';
import { notificar } from '@/modulos/comunicacao/notificar';
import { hojeLocal, segundaDaSemana } from './calendario';
import type { PedidoSerie } from './serie';

const diasEntre = (a: DataLocal, b: DataLocal) => Math.round((Date.UTC(b.ano, b.mes - 1, b.dia) - Date.UTC(a.ano, a.mes - 1, a.dia)) / 86_400_000);

/**
 * Período da renovação (D4): começa no dia seguinte ao fim da série (ou amanhã, se o fim já passou), dura
 * o mesmo que a série anterior e nunca passa de `antecedenciaMaxDias` à frente de hoje. Numa série
 * quinzenal o ritmo continua: se o primeiro dia cair numa semana "de folga", começa na segunda seguinte.
 * Devolve `null` quando ainda não cabe (a série vai tão longe que o novo período estouraria o limite).
 */
export function periodoDaRenovacao(
  serie: { dataInicio: string; dataFim: string; frequencia: 'semanal' | 'quinzenal' },
  antecedenciaMaxDias: number,
  hoje: DataLocal,
): { dataInicio: DataLocal; dataFim: DataLocal } | null {
  const ini = parseDataISO(serie.dataInicio);
  const fim = parseDataISO(serie.dataFim);
  const duracao = diasEntre(ini, fim);
  const amanha = somarDias(hoje, 1);
  const depoisDoFim = somarDias(fim, 1);
  let inicio = formatarDataISO(depoisDoFim) > formatarDataISO(amanha) ? depoisDoFim : amanha;
  if (serie.frequencia === 'quinzenal' && (diasEntre(segundaDaSemana(ini), segundaDaSemana(inicio)) / 7) % 2 !== 0) {
    inicio = somarDias(inicio, 8 - diaSemanaDe(inicio)); // a segunda-feira seguinte
  }
  const limite = somarDias(hoje, antecedenciaMaxDias);
  const novoFim = somarDias(inicio, duracao);
  const dataFim = formatarDataISO(novoFim) > formatarDataISO(limite) ? limite : novoFim;
  if (formatarDataISO(dataFim) < formatarDataISO(inicio)) return null;
  return { dataInicio: inicio, dataFim };
}

export type ErroRenovacao = 'nao_encontrada' | 'nao_renovavel' | 'ja_renovada' | 'cedo_demais';

export const TEXTO_ERRO_RENOVACAO: Record<ErroRenovacao, string> = {
  nao_encontrada: 'Série não encontrada.',
  nao_renovavel: 'Só dá para renovar uma série aprovada (ou que acabou de terminar).',
  ja_renovada: 'Esta série já foi renovada.',
  cedo_demais: 'Ainda é cedo para renovar: a série cobre quase todo o prazo máximo de 60 dias. Volte mais perto do fim.',
};

/** Já existe um pedido de renovação vivo (não recusado, expirado ou cancelado) desta série. */
async function jaRenovada(serieId: string): Promise<boolean> {
  const [r] = await db
    .select({ id: schema.serie.id })
    .from(schema.serie)
    .where(and(eq(schema.serie.renovacaoDeId, serieId), not(inArray(schema.serie.status, ['recusada', 'expirada', 'cancelada']))))
    .limit(1);
  return Boolean(r);
}

/**
 * Tudo o que a tela "Renovar série" precisa para abrir o pedido já preenchido: mesmos dias, horário,
 * frequência e forma de pagamento, num período novo. A renovação é um pedido como outro qualquer
 * (passa por aprovação), só que ligada à série anterior (`renovacao_de_id`).
 */
export async function dadosDaRenovacao(
  serieId: string,
  profissionalId: string,
  agora = new Date(),
): Promise<{ ok: true; pedido: PedidoSerie; renovacaoDeId: string } | { ok: false; erro: ErroRenovacao }> {
  const [x] = await db
    .select({ serie: schema.serie, antecedenciaMaxDias: schema.regraEspaco.antecedenciaMaxDias })
    .from(schema.serie)
    .innerJoin(schema.regraEspaco, eq(schema.regraEspaco.espacoId, schema.serie.espacoId))
    .where(eq(schema.serie.id, serieId));
  if (!x || x.serie.profissionalId !== profissionalId) return { ok: false, erro: 'nao_encontrada' };
  if (x.serie.status !== 'aprovada' && x.serie.status !== 'encerrada') return { ok: false, erro: 'nao_renovavel' };
  if (await jaRenovada(serieId)) return { ok: false, erro: 'ja_renovada' };
  const periodo = periodoDaRenovacao(x.serie, x.antecedenciaMaxDias, hojeLocal(agora));
  if (!periodo) return { ok: false, erro: 'cedo_demais' };
  return {
    ok: true,
    renovacaoDeId: serieId,
    pedido: {
      espacoId: x.serie.espacoId,
      profissionalId,
      diasSemana: x.serie.diasSemana,
      frequencia: x.serie.frequencia,
      unidade: x.serie.unidade,
      turnoId: x.serie.turnoId,
      horaInicio: x.serie.horaInicio,
      horaFim: x.serie.horaFim,
      dataInicio: periodo.dataInicio,
      dataFim: periodo.dataFim,
      formaPagamento: x.serie.formaPagamento,
    },
  };
}

/**
 * Avisa por e-mail, uma única vez por série, que a série está perto do fim (a sala define quantos dias:
 * `aviso_renovacao_serie_dias`) e pode ser renovada. Não avisa de série já renovada.
 */
export async function avisarRenovacaoDeSeries(agora = new Date()): Promise<{ enviados: number }> {
  const hoje = hojeLocal(agora);
  const series = await db
    .select({ serie: schema.serie, aviso: schema.regraEspaco.avisoRenovacaoSerieDias, nome: schema.usuario.name, email: schema.usuario.email })
    .from(schema.serie)
    .innerJoin(schema.regraEspaco, eq(schema.regraEspaco.espacoId, schema.serie.espacoId))
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.serie.profissionalId))
    .where(eq(schema.serie.status, 'aprovada'));

  let enviados = 0;
  for (const s of series) {
    const falta = diasEntre(hoje, parseDataISO(s.serie.dataFim));
    if (falta < 0 || falta > s.aviso) continue;
    if (await jaRenovada(s.serie.id)) continue;
    const m = emailSerieRenovar({ nome: s.nome, dataFim: s.serie.dataFim, serieId: s.serie.id });
    const r = await notificar({ usuarioId: s.serie.profissionalId, para: s.email, tipo: 'serie_renovar', assunto: m.assunto, html: m.html, referenciaTipo: 'serie', referenciaId: s.serie.id });
    if (r === 'enviado') enviados++;
  }
  return { enviados };
}
