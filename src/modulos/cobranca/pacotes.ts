import { and, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { formatarReais } from '@/lib/dinheiro';
import { registrarAuditoria } from '@/modulos/auditoria/auditoria';
import { concederCredito } from '@/modulos/carteira/carteira';
import { emailCreditoComprado } from '@/modulos/comunicacao/modelos';
import { notificar } from '@/modulos/comunicacao/notificar';
import { asaasAtivo } from './asaas';
import { prepararPagamentoOnline } from './online';
import { emitirReciboSemFalhar } from './recibo';

const DIA_MS = 86_400_000;

export type ErroCompra = 'pacote_invalido' | 'profissional_nao_pode' | 'pagamento_indisponivel';

export const TEXTO_ERRO_COMPRA: Record<ErroCompra, string> = {
  pacote_invalido: 'Este pacote não está mais disponível.',
  profissional_nao_pode: 'Seu cadastro precisa estar aprovado para comprar crédito.',
  pagamento_indisponivel: 'O pagamento online está indisponível no momento. Tente de novo em instantes.',
};

export async function listarPacotesAtivos(espacoId: string) {
  return db
    .select()
    .from(schema.pacoteCredito)
    .where(and(eq(schema.pacoteCredito.espacoId, espacoId), eq(schema.pacoteCredito.ativo, true)))
    .orderBy(schema.pacoteCredito.valorPagoCentavos);
}

/**
 * O Profissional compra um pacote de crédito (banco de horas): cria a cobrança e o Pix no Asaas.
 * Compra só existe com o pagamento online ligado (não há "Pix manual" para isso): se o Asaas está
 * desligado ou falha, nada fica gravado e a pessoa vê a mensagem de indisponível.
 * O crédito só entra na carteira quando o pagamento é reconhecido (`concluirCompraCredito`).
 */
export async function comprarPacote(
  profissionalId: string,
  pacoteId: string,
  agora = new Date(),
): Promise<{ ok: true; cobrancaId: string } | { ok: false; erro: ErroCompra }> {
  const [pacote] = await db.select().from(schema.pacoteCredito).where(and(eq(schema.pacoteCredito.id, pacoteId), eq(schema.pacoteCredito.ativo, true)));
  if (!pacote) return { ok: false, erro: 'pacote_invalido' };
  const [prof] = await db.select({ status: schema.profissional.status }).from(schema.profissional).where(eq(schema.profissional.usuarioId, profissionalId));
  if (prof?.status !== 'aprovado') return { ok: false, erro: 'profissional_nao_pode' };
  if (!asaasAtivo()) return { ok: false, erro: 'pagamento_indisponivel' };

  const cobrancaId = await db.transaction(async (tx) => {
    const [c] = await tx
      .insert(schema.cobranca)
      .values({
        profissionalId,
        finalidade: 'compra_credito',
        valorBrutoCentavos: pacote.valorPagoCentavos,
        valorCobradoCentavos: pacote.valorPagoCentavos,
        venceEm: new Date(agora.getTime() + 3 * DIA_MS),
      })
      .returning({ id: schema.cobranca.id });
    await tx.insert(schema.cobrancaItem).values({ cobrancaId: c.id, pacoteCreditoId: pacote.id, valorCentavos: pacote.valorPagoCentavos });
    return c.id;
  });

  const online = await prepararPagamentoOnline(cobrancaId, `Banco de horas: ${pacote.nome}`);
  if (!online) {
    // Sem pagamento online a compra não tem como ser paga: desfaz o que foi gravado.
    await db.delete(schema.cobranca).where(eq(schema.cobranca.id, cobrancaId)); // item em cascata
    return { ok: false, erro: 'pagamento_indisponivel' };
  }
  await registrarAuditoria({ usuarioId: profissionalId, acao: 'compra_credito_iniciada', entidade: 'cobranca', entidadeId: cobrancaId, dados: { pacoteId, valorPagoCentavos: pacote.valorPagoCentavos } });
  return { ok: true, cobrancaId };
}

/**
 * O pagamento do pacote foi reconhecido: marca a cobrança como paga e coloca na carteira o valor
 * do crédito (que pode ser maior que o pago: o bônus), tudo numa transação. Não credita duas vezes.
 */
export async function concluirCompraCredito(
  cobrancaId: string,
  meio: 'pix' | 'cartao',
  agora = new Date(),
): Promise<{ creditoCentavos: number } | null> {
  const [c] = await db
    .select({ cobranca: schema.cobranca, pacote: schema.pacoteCredito, nome: schema.usuario.name, email: schema.usuario.email })
    .from(schema.cobranca)
    .innerJoin(schema.cobrancaItem, eq(schema.cobrancaItem.cobrancaId, schema.cobranca.id))
    .innerJoin(schema.pacoteCredito, eq(schema.pacoteCredito.id, schema.cobrancaItem.pacoteCreditoId))
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.cobranca.profissionalId))
    .where(eq(schema.cobranca.id, cobrancaId));
  if (!c) return null;

  const creditou = await db.transaction(async (tx) => {
    const mudou = await tx
      .update(schema.cobranca)
      .set({ status: 'paga', meio, pagoEm: agora })
      .where(and(eq(schema.cobranca.id, cobrancaId), eq(schema.cobranca.status, 'pendente')))
      .returning({ id: schema.cobranca.id });
    if (mudou.length === 0) return false; // já creditado (aviso repetido)
    await concederCredito(
      tx,
      { profissionalId: c.cobranca.profissionalId, espacoId: c.pacote.espacoId, origem: 'compra', valorCentavos: c.pacote.valorCreditoCentavos, cobrancaId },
      agora,
    );
    return true;
  });
  if (!creditou) return null;

  await emitirReciboSemFalhar(cobrancaId);
  await registrarAuditoria({ usuarioId: null, acao: 'compra_credito_paga', entidade: 'cobranca', entidadeId: cobrancaId, dados: { creditoCentavos: c.pacote.valorCreditoCentavos } });
  const m = emailCreditoComprado({ nome: c.nome, pacote: c.pacote.nome, pago: formatarReais(c.pacote.valorPagoCentavos), credito: formatarReais(c.pacote.valorCreditoCentavos) });
  await notificar({
    usuarioId: c.cobranca.profissionalId,
    para: c.email,
    tipo: 'credito_comprado',
    assunto: m.assunto,
    html: m.html,
    referenciaTipo: 'cobranca',
    referenciaId: cobrancaId,
  });
  return { creditoCentavos: c.pacote.valorCreditoCentavos };
}

/** Compras de crédito ainda não pagas (para a pessoa voltar ao Pix depois de sair da tela). */
export async function comprasPendentes(profissionalId: string) {
  return db
    .select({ id: schema.cobranca.id, valorCentavos: schema.cobranca.valorCobradoCentavos, pacote: schema.pacoteCredito.nome })
    .from(schema.cobranca)
    .innerJoin(schema.cobrancaItem, eq(schema.cobrancaItem.cobrancaId, schema.cobranca.id))
    .innerJoin(schema.pacoteCredito, eq(schema.pacoteCredito.id, schema.cobrancaItem.pacoteCreditoId))
    .where(and(eq(schema.cobranca.profissionalId, profissionalId), eq(schema.cobranca.finalidade, 'compra_credito'), eq(schema.cobranca.status, 'pendente')))
    .orderBy(schema.cobranca.criadoEm);
}
