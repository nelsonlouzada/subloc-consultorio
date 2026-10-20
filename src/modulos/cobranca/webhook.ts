import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { formatarReais } from '@/lib/dinheiro';
import { registrarAuditoria } from '@/modulos/auditoria/auditoria';
import { confirmarPagamento } from '@/modulos/agenda/pagamento';
import { descreverPeriodo } from '@/modulos/agenda/calendario';
import { concederCredito } from '@/modulos/carteira/carteira';
import { emailPagamentoAtrasadoVirouCredito } from '@/modulos/comunicacao/modelos';
import { notificar } from '@/modulos/comunicacao/notificar';
import { concluirCompraCredito } from './pacotes';
import { emitirReciboSemFalhar } from './recibo';

export type ResultadoEvento = { situacao: 'processado' | 'ignorado' | 'problema'; detalhe?: string };

type Pagamento = { id?: string; value?: number; billingType?: string; status?: string; externalReference?: string };

const EVENTOS_DE_PAGAMENTO = new Set(['PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED']);
const meioDe = (billingType?: string): 'pix' | 'cartao' => (billingType === 'CREDIT_CARD' ? 'cartao' : 'pix');

/**
 * Aplica um aviso do Asaas. Erros de dados (cobrança desconhecida, valor diferente) NÃO derrubam a
 * resposta: ficam registrados como `problema` para alguém olhar, porque o Asaas reenviaria o mesmo
 * aviso para sempre. Só falhas inesperadas (banco fora do ar) viram exceção, e aí o Asaas tenta de novo.
 */
export async function aplicarEventoAsaas(corpo: { event?: string; payment?: Pagamento }, agora = new Date()): Promise<ResultadoEvento> {
  if (!corpo.event || !EVENTOS_DE_PAGAMENTO.has(corpo.event)) return { situacao: 'ignorado', detalhe: corpo.event };
  const pg = corpo.payment;
  if (!pg?.id) return { situacao: 'problema', detalhe: 'aviso de pagamento sem id' };

  const [c] = await db.select().from(schema.cobranca).where(eq(schema.cobranca.asaasCobrancaId, pg.id));
  if (!c) return { situacao: 'problema', detalhe: `cobrança desconhecida (${pg.id})` };
  if (pg.externalReference && pg.externalReference !== c.id) return { situacao: 'problema', detalhe: 'referência da cobrança não confere' };
  if (c.status === 'paga') return { situacao: 'ignorado', detalhe: 'já paga' };
  // O valor que o Asaas diz ter recebido precisa ser o que cobramos: nada se confirma com valor diferente.
  if (typeof pg.value !== 'number' || Math.round(pg.value * 100) !== c.valorCobradoCentavos) {
    return { situacao: 'problema', detalhe: `valor recebido (${pg.value}) diferente do cobrado (${c.valorCobradoCentavos / 100})` };
  }
  const meio = meioDe(pg.billingType);

  if (c.finalidade === 'compra_credito') {
    await concluirCompraCredito(c.id, meio, agora);
    return { situacao: 'processado' };
  }

  const [item] = await db.select({ reservaId: schema.cobrancaItem.reservaId }).from(schema.cobrancaItem).where(eq(schema.cobrancaItem.cobrancaId, c.id));
  if (!item?.reservaId) return { situacao: 'problema', detalhe: 'cobrança sem reserva' };
  const [r] = await db.select().from(schema.reserva).where(eq(schema.reserva.id, item.reservaId));
  if (!r) return { situacao: 'problema', detalhe: 'reserva não encontrada' };

  const esperandoPagamento = r.status === 'aguardando_pagamento' && c.status === 'pendente';
  const expirada = r.status === 'expirada' && c.status === 'expirada';
  if (esperandoPagamento || expirada) {
    await confirmarPagamento(r.id, { usuarioId: null, meio }, {}, agora);
    return { situacao: 'processado' };
  }

  // O dinheiro chegou, mas a reserva já não existe mais para receber (cancelada, ou já paga por outro meio):
  // nada se perde, o valor vira crédito integral na carteira.
  const [u] = await db.select({ nome: schema.usuario.name, email: schema.usuario.email }).from(schema.usuario).where(eq(schema.usuario.id, c.profissionalId));
  const virou = await db.transaction(async (tx) => {
    const mudou = await tx
      .update(schema.cobranca)
      .set({ status: 'paga', meio, pagoEm: agora })
      .where(and(eq(schema.cobranca.id, c.id), eq(schema.cobranca.status, c.status)))
      .returning({ id: schema.cobranca.id });
    if (mudou.length === 0) return false;
    await concederCredito(tx, { profissionalId: c.profissionalId, espacoId: r.espacoId, origem: 'pagamento_atrasado', valorCentavos: c.valorCobradoCentavos, reservaId: r.id, cobrancaId: c.id }, agora);
    return true;
  });
  if (virou) {
    await emitirReciboSemFalhar(c.id);
    await registrarAuditoria({ usuarioId: null, acao: 'pagamento_sem_reserva_virou_credito', entidade: 'reserva', entidadeId: r.id, dados: { valorCentavos: c.valorCobradoCentavos, statusReserva: r.status } });
    if (u) {
      const m = emailPagamentoAtrasadoVirouCredito({ nome: u.nome, periodo: descreverPeriodo(r.inicio, r.fim), valor: formatarReais(c.valorCobradoCentavos) });
      await notificar({ usuarioId: c.profissionalId, para: u.email, tipo: 'pagamento_atrasado_credito', assunto: m.assunto, html: m.html, referenciaTipo: 'reserva', referenciaId: r.id });
    }
  }
  return { situacao: 'processado', detalhe: 'virou crédito' };
}
