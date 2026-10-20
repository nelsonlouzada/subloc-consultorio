import { and, asc, eq, gt, isNull, lte } from 'drizzle-orm';
import { db, schema } from '@/db';

const HORA_MS = 3_600_000;

/** Pagamentos que vencem em até esta janela entram no alerta "prestes a expirar". */
export const JANELA_PAGAMENTO_EXPIRANDO_MS = HORA_MS;

/**
 * O que precisa de ação do Anfitrião além das solicitações e dos cadastros (A5):
 * códigos de acesso a enviar (reserva confirmada ainda sem código) e pagamentos prestes a expirar.
 */
export async function listarPendenciasDaSala(espacoId: string, agora = new Date()) {
  const codigosAEnviar = await db
    .select({
      id: schema.reserva.id,
      inicio: schema.reserva.inicio,
      fim: schema.reserva.fim,
      profissional: schema.usuario.name,
    })
    .from(schema.reserva)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.reserva.profissionalId))
    .where(
      and(
        eq(schema.reserva.espacoId, espacoId),
        eq(schema.reserva.status, 'confirmada'),
        gt(schema.reserva.fim, agora),
        isNull(schema.reserva.codigoAcessoEnviadoEm),
      ),
    )
    .orderBy(asc(schema.reserva.inicio));

  const pagamentosExpirando = await db
    .select({
      id: schema.reserva.id,
      inicio: schema.reserva.inicio,
      fim: schema.reserva.fim,
      prazo: schema.reserva.prazoPagamentoAte,
      profissional: schema.usuario.name,
    })
    .from(schema.reserva)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.reserva.profissionalId))
    .where(
      and(
        eq(schema.reserva.espacoId, espacoId),
        eq(schema.reserva.status, 'aguardando_pagamento'),
        lte(schema.reserva.prazoPagamentoAte, new Date(agora.getTime() + JANELA_PAGAMENTO_EXPIRANDO_MS)),
      ),
    )
    .orderBy(asc(schema.reserva.prazoPagamentoAte));

  return { codigosAEnviar, pagamentosExpirando };
}
