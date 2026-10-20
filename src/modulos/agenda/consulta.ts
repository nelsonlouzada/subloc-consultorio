import { desc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db, schema } from '@/db';

/** Uma reserva com tudo que as telas de detalhe precisam (Anfitrião e Profissional). */
export async function obterReserva(id: string) {
  const aprovador = alias(schema.usuario, 'aprovador');
  const [r] = await db
    .select({
      reserva: schema.reserva,
      profissionalNome: schema.usuario.name,
      profissionalEmail: schema.usuario.email,
      aprovadaPorNome: aprovador.name,
    })
    .from(schema.reserva)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.reserva.profissionalId))
    .leftJoin(aprovador, eq(aprovador.id, schema.reserva.aprovadaPor))
    .where(eq(schema.reserva.id, id));
  if (!r) return null;

  const [cobranca] = await db
    .select({ cobranca: schema.cobranca })
    .from(schema.cobrancaItem)
    .innerJoin(schema.cobranca, eq(schema.cobranca.id, schema.cobrancaItem.cobrancaId))
    .where(eq(schema.cobrancaItem.reservaId, id))
    .orderBy(desc(schema.cobranca.criadoEm))
    .limit(1);

  return { ...r, cobranca: cobranca?.cobranca ?? null };
}

export type ReservaDetalhada = NonNullable<Awaited<ReturnType<typeof obterReserva>>>;

/** Rótulos de estado, os mesmos em todas as telas. */
export const ROTULO_STATUS: Record<string, { nome: string; cor: string }> = {
  solicitada: { nome: 'Aguardando aprovação', cor: 'bg-amber-100 text-amber-900' },
  aguardando_pagamento: { nome: 'Aprovada, aguardando pagamento', cor: 'bg-orange-100 text-orange-900' },
  confirmada: { nome: 'Confirmada', cor: 'bg-green-100 text-green-900' },
  realizada: { nome: 'Realizada', cor: 'bg-zinc-100 text-zinc-700' },
  falta: { nome: 'Falta', cor: 'bg-red-100 text-red-900' },
  recusada: { nome: 'Recusada', cor: 'bg-red-100 text-red-900' },
  expirada: { nome: 'Expirada', cor: 'bg-zinc-100 text-zinc-700' },
  cancelada: { nome: 'Cancelada', cor: 'bg-zinc-100 text-zinc-700' },
};
