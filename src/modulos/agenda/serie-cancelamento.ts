import { and, eq, gt, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { formatarReais } from '@/lib/dinheiro';
import { registrarAuditoria } from '@/modulos/auditoria/auditoria';
import { concederCredito, creditoPorCancelamento, devolverUso, devolverUsoDaCobranca } from '@/modulos/carteira/carteira';
import { cancelarPagamentoOnline } from '@/modulos/cobranca/online';
import { emailSerieCancelada, emailSerieCanceladaAviso } from '@/modulos/comunicacao/modelos';
import { anfitrioesAtivos, notificar } from '@/modulos/comunicacao/notificar';
import { EstadoReservaError, ReservaNaoEncontradaError } from './solicitacao';

type Quem = { id: string; papel: 'anfitriao' | 'profissional' };

export type ResultadoCancelamentoSerie = {
  /** Datas que ainda não tinham começado e foram canceladas. */
  canceladas: number;
  /** Crédito total devolvido às datas já pagas (política da sala, ou integral quando é o Anfitrião quem cancela). */
  creditoCentavos: number;
};

const ABERTAS = ['solicitada', 'aprovada', 'aguardando_pagamento', 'confirmada'] as const;

/**
 * Cancela a série: todas as datas que ainda não começaram. Pagamentos ainda abertos são cancelados (e o
 * crédito que os abatia volta); datas já pagas viram crédito, cada uma pela política da sala conforme a
 * própria antecedência (pela profissional), ou integral (pelo Anfitrião). Datas passadas não mudam.
 * Tudo numa transação: ou a série inteira é cancelada, ou nada.
 */
export async function cancelarSerie(serieId: string, quem: Quem, opcoes: { ip?: string | null } = {}, agora = new Date()): Promise<ResultadoCancelamentoSerie> {
  const [s] = await db
    .select({
      serie: schema.serie,
      nome: schema.usuario.name,
      email: schema.usuario.email,
      integralHoras: schema.regraEspaco.cancelamentoIntegralHoras,
      parcialHoras: schema.regraEspaco.cancelamentoParcialHoras,
      parcialPct: schema.regraEspaco.cancelamentoParcialPct,
    })
    .from(schema.serie)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.serie.profissionalId))
    .innerJoin(schema.regraEspaco, eq(schema.regraEspaco.espacoId, schema.serie.espacoId))
    .where(eq(schema.serie.id, serieId));
  // Série de outra pessoa é como se não existisse.
  if (!s || (quem.papel === 'profissional' && s.serie.profissionalId !== quem.id)) throw new ReservaNaoEncontradaError();
  if (s.serie.status !== 'solicitada' && s.serie.status !== 'aprovada') throw new EstadoReservaError(s.serie.status);
  const politica = { integralHoras: s.integralHoras, parcialHoras: s.parcialHoras, parcialPct: s.parcialPct };

  const aCancelarNoAsaas: string[] = [];
  const resultado = await db.transaction(async (tx) => {
    const mudou = await tx
      .update(schema.serie)
      .set({ status: 'cancelada' })
      .where(and(eq(schema.serie.id, serieId), inArray(schema.serie.status, ['solicitada', 'aprovada'])))
      .returning({ id: schema.serie.id });
    if (mudou.length === 0) throw new EstadoReservaError('já decidida');

    const futuras = await tx
      .select()
      .from(schema.reserva)
      .where(and(eq(schema.reserva.serieId, serieId), inArray(schema.reserva.status, [...ABERTAS]), gt(schema.reserva.inicio, agora)));
    if (futuras.length === 0) return { canceladas: 0, creditoCentavos: 0 };
    const ids = futuras.map((r) => r.id);

    await tx
      .update(schema.reserva)
      .set({ status: 'cancelada', canceladaPor: quem.id, canceladaEm: agora, codigoAcesso: null })
      .where(and(inArray(schema.reserva.id, ids), inArray(schema.reserva.status, [...ABERTAS])));
    await tx.delete(schema.ocupacao).where(inArray(schema.ocupacao.reservaId, ids));

    const itens = await tx
      .select({
        reservaId: schema.cobrancaItem.reservaId,
        cobrancaId: schema.cobranca.id,
        status: schema.cobranca.status,
        asaasId: schema.cobranca.asaasCobrancaId,
      })
      .from(schema.cobrancaItem)
      .innerJoin(schema.cobranca, eq(schema.cobranca.id, schema.cobrancaItem.cobrancaId))
      .where(inArray(schema.cobrancaItem.reservaId, ids));

    // Cobranças ainda abertas: cancela e devolve o crédito que as abatia.
    const abertas = new Map(itens.filter((i) => i.status === 'pendente').map((i) => [i.cobrancaId, i.asaasId]));
    for (const [cobrancaId, asaasId] of abertas) {
      await tx.update(schema.cobranca).set({ status: 'cancelada' }).where(eq(schema.cobranca.id, cobrancaId));
      await devolverUsoDaCobranca(tx, cobrancaId, agora);
      if (asaasId) aCancelarNoAsaas.push(asaasId);
    }
    const reservasDeCobrancaAberta = new Set(itens.filter((i) => i.status === 'pendente').map((i) => i.reservaId));
    for (const r of futuras) {
      if (reservasDeCobrancaAberta.has(r.id)) await devolverUso(tx, r.id, agora); // crédito que abateu uma reserva individual
    }

    // Datas já pagas: viram crédito.
    const pagas = new Set(itens.filter((i) => i.status === 'paga').map((i) => i.reservaId));
    let creditoCentavos = 0;
    for (const r of futuras) {
      if (!pagas.has(r.id) || r.valorCentavos <= 0) continue;
      const credito = quem.papel === 'anfitriao' ? r.valorCentavos : creditoPorCancelamento(politica, r.inicio, agora, r.valorCentavos).creditoCentavos;
      if (credito <= 0) continue;
      await concederCredito(tx, { profissionalId: s.serie.profissionalId, espacoId: s.serie.espacoId, origem: 'cancelamento', valorCentavos: credito, reservaId: r.id, criadoPor: quem.id }, agora);
      await tx.update(schema.reserva).set({ creditoGeradoCentavos: credito }).where(eq(schema.reserva.id, r.id));
      creditoCentavos += credito;
    }
    return { canceladas: futuras.length, creditoCentavos };
  });

  await cancelarPagamentoOnline(aCancelarNoAsaas);
  await registrarAuditoria({
    usuarioId: quem.id,
    acao: quem.papel === 'anfitriao' ? 'serie_cancelada' : 'serie_cancelada_profissional',
    entidade: 'serie',
    entidadeId: serieId,
    dados: { ...resultado, statusAnterior: s.serie.status },
    ip: opcoes.ip ?? null,
  });

  const credito = resultado.creditoCentavos > 0 ? formatarReais(resultado.creditoCentavos) : null;
  const m = emailSerieCancelada({ nome: s.nome, canceladas: resultado.canceladas, credito, pelaProfissional: quem.papel === 'profissional' });
  await notificar({ usuarioId: s.serie.profissionalId, para: s.email, tipo: 'serie_cancelada', assunto: m.assunto, html: m.html, referenciaTipo: 'serie', referenciaId: serieId });
  if (quem.papel === 'profissional') {
    const aviso = emailSerieCanceladaAviso({ nome: s.nome, canceladas: resultado.canceladas, credito });
    for (const a of await anfitrioesAtivos()) {
      await notificar({ usuarioId: a.id, para: a.email, tipo: 'serie_cancelada_profissional', assunto: aviso.assunto, html: aviso.html, referenciaTipo: 'serie', referenciaId: serieId });
    }
  }
  return resultado;
}
