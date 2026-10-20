import * as Sentry from '@sentry/node';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { asaasAtivo, cancelarCobrancaAsaas, criarCobrancaPix, garantirCliente } from './asaas';

export type PagamentoOnline = { copiaCola: string; faturaUrl: string | null };

/**
 * Cria a cobrança Pix no Asaas para uma cobrança nossa e guarda QR, copia-e-cola e link da fatura.
 * Devolve `null` quando o pagamento online está desligado ou quando o Asaas falha: quem chama
 * segue com o Pix manual (a falha vai para o Sentry), então aprovar um pedido nunca depende de
 * o Asaas estar no ar. Não cria duas vezes: se a cobrança já tem id do Asaas, devolve o que existe.
 */
export async function prepararPagamentoOnline(cobrancaId: string, descricao: string): Promise<PagamentoOnline | null> {
  if (!asaasAtivo()) return null;
  try {
    const [c] = await db.select().from(schema.cobranca).where(eq(schema.cobranca.id, cobrancaId));
    if (!c || c.status !== 'pendente' || c.valorCobradoCentavos <= 0) return null;
    if (c.asaasCobrancaId && c.pixCopiaCola) return { copiaCola: c.pixCopiaCola, faturaUrl: c.asaasLinkFatura };

    const clienteId = await garantirCliente(c.profissionalId);
    const pix = await criarCobrancaPix({
      clienteId,
      valorCentavos: c.valorCobradoCentavos,
      venceEm: c.venceEm ?? new Date(Date.now() + 86_400_000),
      descricao,
      referencia: c.id,
    });
    await db
      .update(schema.cobranca)
      .set({ asaasCobrancaId: pix.id, asaasLinkFatura: pix.faturaUrl, pixCopiaCola: pix.copiaCola, pixQrImagem: pix.qrImagem })
      .where(eq(schema.cobranca.id, cobrancaId));
    return { copiaCola: pix.copiaCola, faturaUrl: pix.faturaUrl };
  } catch (e) {
    Sentry.captureException(e, { tags: { fluxo: 'asaas_criar_cobranca' } });
    console.error('[asaas] não foi possível criar a cobrança; seguindo com Pix manual:', e instanceof Error ? e.message : e);
    return null;
  }
}

/** Cancela no Asaas as cobranças online ainda abertas de uma reserva que foi cancelada sem pagamento. Melhor esforço. */
export async function cancelarPagamentoOnline(asaasCobrancaIds: string[]): Promise<void> {
  if (!asaasAtivo()) return;
  for (const id of asaasCobrancaIds) {
    try {
      await cancelarCobrancaAsaas(id);
    } catch (e) {
      Sentry.captureException(e, { tags: { fluxo: 'asaas_cancelar_cobranca' } });
    }
  }
}
