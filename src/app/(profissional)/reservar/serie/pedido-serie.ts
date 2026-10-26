import { formatarDataISO } from '@/lib/fuso';
import type { PedidoSerie } from '@/modulos/agenda/serie';
import { dataValida } from '../pedido';

/** Parâmetros da série como chegam da URL ou do formulário (sempre texto, nunca confiáveis). */
export type ParametrosSerie = {
  dias?: string | string[];
  freq?: string;
  unidade?: string;
  turno?: string;
  de?: string;
  ate?: string;
  inicio?: string;
  fim?: string;
  pag?: string;
  renovacaoDe?: string;
  erro?: string;
};

const inteiro = (t?: string) => (t !== undefined && /^\d{1,2}$/.test(t) ? Number(t) : null);

/** Transforma os parâmetros num pedido de série. Devolve null se algo não fecha; quem decide é `avaliarSerie`. */
export function pedidoDeSerieDosParametros(p: ParametrosSerie, espacoId: string, profissionalId: string): PedidoSerie | null {
  const dataInicio = dataValida(p.inicio);
  const dataFim = dataValida(p.fim);
  if (!dataInicio || !dataFim) return null;
  const dias = (Array.isArray(p.dias) ? p.dias : p.dias ? [p.dias] : []).map((d) => inteiro(d)).filter((d): d is number => d !== null);
  const frequencia = p.freq === 'quinzenal' ? 'quinzenal' : p.freq === 'semanal' ? 'semanal' : null;
  const formaPagamento = p.pag === 'pacote_mes' ? 'pacote_mes' : p.pag === 'por_ocorrencia' ? 'por_ocorrencia' : null;
  const unidade = p.unidade === 'hora' || p.unidade === 'turno' || p.unidade === 'dia' ? p.unidade : null;
  if (!frequencia || !formaPagamento || !unidade) return null;
  return {
    espacoId,
    profissionalId,
    diasSemana: dias,
    frequencia,
    unidade,
    turnoId: unidade === 'turno' ? (p.turno ?? null) : null,
    horaInicio: unidade === 'hora' ? inteiro(p.de) : null,
    horaFim: unidade === 'hora' ? inteiro(p.ate) : null,
    dataInicio,
    dataFim,
    formaPagamento,
  };
}

/** O contrário: os parâmetros de um pedido, para links (renovar, voltar ao formulário). */
export function parametrosDoPedido(p: PedidoSerie, extra: Record<string, string> = {}): URLSearchParams {
  const q = new URLSearchParams();
  for (const d of p.diasSemana) q.append('dias', String(d));
  q.set('freq', p.frequencia);
  q.set('unidade', p.unidade);
  if (p.turnoId) q.set('turno', p.turnoId);
  if (p.horaInicio != null) q.set('de', String(p.horaInicio));
  if (p.horaFim != null) q.set('ate', String(p.horaFim));
  q.set('inicio', formatarDataISO(p.dataInicio));
  q.set('fim', formatarDataISO(p.dataFim));
  q.set('pag', p.formaPagamento);
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  return q;
}
