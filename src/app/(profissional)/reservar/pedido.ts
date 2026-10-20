import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { type DataLocal, instanteLocal, parseDataISO } from '@/lib/fuso';
import type { PedidoReserva } from '@/modulos/agenda/reserva';

/** Parâmetros do pedido como chegam da URL ou do formulário (sempre texto, nunca confiáveis). */
export type ParametrosPedido = {
  data?: string;
  unidade?: string;
  de?: string;
  ate?: string;
  turno?: string;
};

export function dataValida(texto?: string): DataLocal | null {
  try {
    return texto ? parseDataISO(texto) : null;
  } catch {
    return null;
  }
}

const hora = (t?: string) => (t !== undefined && /^\d{1,2}$/.test(t) ? Number(t) : null);

/**
 * Transforma os parâmetros num pedido de verdade (instantes em hora local da sala). Devolve
 * null se algo não fecha; quem decide se o horário pode ser reservado é `avaliarPedido`.
 */
export async function pedidoDosParametros(
  p: ParametrosPedido,
  espacoId: string,
  profissionalId: string,
  abre: number,
  fecha: number,
): Promise<PedidoReserva | null> {
  const dia = dataValida(p.data);
  if (!dia) return null;
  const em = (h: number) => instanteLocal(dia.ano, dia.mes, dia.dia, h);

  if (p.unidade === 'dia') {
    return { espacoId, profissionalId, inicio: em(abre), fim: em(fecha), unidade: 'dia' };
  }
  if (p.unidade === 'turno' && p.turno) {
    const [t] = await db
      .select()
      .from(schema.turno)
      .where(and(eq(schema.turno.id, p.turno), eq(schema.turno.espacoId, espacoId)))
      .catch(() => []); // id que não é UUID vira "não achou"
    if (!t) return null;
    return { espacoId, profissionalId, inicio: em(Number(t.inicio.slice(0, 2))), fim: em(Number(t.fim.slice(0, 2))), unidade: 'turno', turnoId: t.id };
  }
  if (p.unidade === 'hora') {
    const de = hora(p.de);
    const ate = hora(p.ate);
    if (de === null || ate === null || ate <= de || ate > 24) return null;
    return { espacoId, profissionalId, inicio: em(de), fim: em(ate), unidade: 'hora' };
  }
  return null;
}
