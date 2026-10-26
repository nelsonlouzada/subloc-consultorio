import { and, eq, isNotNull, lte, ne, or, sql } from 'drizzle-orm';
import { db, schema } from '@/db';

/**
 * Roda de hora em hora no worker:
 * - reservas confirmadas que já terminaram passam a `realizada`;
 * - o código de acesso de toda reserva que terminou ou deixou de estar confirmada é apagado
 *   (decisão T2: o código só existe enquanto a reserva vale).
 */
export async function encerrarReservas(agora = new Date()): Promise<{ realizadas: number; codigosApagados: number }> {
  return db.transaction(async (tx) => {
    const realizadas = await tx
      .update(schema.reserva)
      .set({ status: 'realizada' })
      .where(and(eq(schema.reserva.status, 'confirmada'), lte(schema.reserva.fim, agora)))
      .returning({ id: schema.reserva.id });

    const apagados = await tx
      .update(schema.reserva)
      .set({ codigoAcesso: null })
      .where(and(isNotNull(schema.reserva.codigoAcesso), or(ne(schema.reserva.status, 'confirmada'), lte(schema.reserva.fim, agora))))
      .returning({ id: schema.reserva.id });

    // Série aprovada sem mais nenhuma ocorrência por vir (nem aprovada, nem a pagar, nem confirmada) está encerrada.
    await tx.execute(sql`
      update serie set status = 'encerrada'
      where status = 'aprovada'
        and not exists (
          select 1 from reserva
          where reserva.serie_id = serie.id and reserva.status in ('aprovada', 'aguardando_pagamento', 'confirmada')
        )`);

    return { realizadas: realizadas.length, codigosApagados: apagados.length };
  });
}
