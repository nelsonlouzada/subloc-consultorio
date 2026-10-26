import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { marcarPago, type ResultadoPagamento } from './pagamento';
import { marcarPagoCobrancaDeSerie } from './serie-pagamento';
import { ReservaNaoEncontradaError } from './solicitacao';

/**
 * O Anfitrião marca o pagamento a partir de uma reserva. Para reserva avulsa é `marcarPago`. Para uma data de
 * série, a cobrança pode cobrir várias datas (pacote do mês), então vale a regra da cobrança inteira.
 */
export async function marcarPagoDaReserva(
  reservaId: string,
  anfitriaoId: string,
  opcoes: { ip?: string | null } = {},
  agora = new Date(),
): Promise<ResultadoPagamento> {
  const [r] = await db.select({ serieId: schema.reserva.serieId }).from(schema.reserva).where(eq(schema.reserva.id, reservaId));
  if (!r) throw new ReservaNaoEncontradaError();
  if (!r.serieId) return marcarPago(reservaId, anfitriaoId, opcoes, agora);

  const [c] = await db
    .select({ id: schema.cobranca.id })
    .from(schema.cobrancaItem)
    .innerJoin(schema.cobranca, eq(schema.cobranca.id, schema.cobrancaItem.cobrancaId))
    .where(eq(schema.cobrancaItem.reservaId, reservaId))
    .orderBy(desc(schema.cobranca.criadoEm))
    .limit(1);
  if (!c) throw new ReservaNaoEncontradaError();
  const resultado = await marcarPagoCobrancaDeSerie(c.id, anfitriaoId, opcoes, agora);
  return { reativada: false, creditoCentavos: resultado?.creditoCentavos ?? 0 };
}

