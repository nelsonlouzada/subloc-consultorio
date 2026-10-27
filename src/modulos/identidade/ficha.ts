import { and, count, desc, asc, eq, gt, inArray, lte } from 'drizzle-orm';
import { db, schema } from '@/db';

/**
 * Reservas de um profissional para a ficha dele (T23). "Próximas" são as que ainda ocupam ou
 * disputam a sala; "recentes" são as que já terminaram, de qualquer forma.
 */

const EM_ABERTO = ['solicitada', 'aguardando_pagamento', 'aprovada', 'confirmada'] as const;
const ENCERRADAS = ['realizada', 'falta', 'cancelada', 'recusada', 'expirada'] as const;

export type ReservaDaFicha = { id: string; inicio: Date; fim: Date; status: string; valorCentavos: number; serieId: string | null };

export async function reservasDaFicha(profissionalId: string, agora = new Date()) {
  const colunas = {
    id: schema.reserva.id,
    inicio: schema.reserva.inicio,
    fim: schema.reserva.fim,
    status: schema.reserva.status,
    valorCentavos: schema.reserva.valorCentavos,
    serieId: schema.reserva.serieId,
  };

  const proximas: ReservaDaFicha[] = await db
    .select(colunas)
    .from(schema.reserva)
    .where(and(eq(schema.reserva.profissionalId, profissionalId), inArray(schema.reserva.status, [...EM_ABERTO]), gt(schema.reserva.fim, agora)))
    .orderBy(asc(schema.reserva.inicio))
    .limit(30);

  const recentes: ReservaDaFicha[] = await db
    .select(colunas)
    .from(schema.reserva)
    .where(and(eq(schema.reserva.profissionalId, profissionalId), inArray(schema.reserva.status, [...ENCERRADAS]), lte(schema.reserva.inicio, agora)))
    .orderBy(desc(schema.reserva.inicio))
    .limit(10);

  const porStatus = await db
    .select({ status: schema.reserva.status, total: count() })
    .from(schema.reserva)
    .where(eq(schema.reserva.profissionalId, profissionalId))
    .groupBy(schema.reserva.status);
  const total = (s: string) => porStatus.find((x) => x.status === s)?.total ?? 0;

  return {
    proximas,
    recentes,
    contagens: { realizadas: total('realizada'), faltas: total('falta'), canceladas: total('cancelada'), todas: porStatus.reduce((t, x) => t + x.total, 0) },
  };
}

export const ROTULO_ORIGEM_CREDITO: Record<string, string> = {
  compra: 'Compra',
  cancelamento: 'Cancelamento',
  pagamento_atrasado: 'Pagamento atrasado',
  ajuste_manual: 'Crédito manual',
};

export const ROTULO_MOVIMENTO: Record<string, string> = {
  entrada: 'Entrada',
  uso: 'Uso em pedido',
  devolucao_uso: 'Devolução de uso',
  vencimento: 'Vencimento',
  ajuste: 'Ajuste',
};
