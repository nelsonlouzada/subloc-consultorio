import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { registrarAuditoria } from '@/modulos/auditoria/auditoria';
import { devolverUso, devolverUsoDaCobranca } from '@/modulos/carteira/carteira';
import { emailReservaExpirada } from '@/modulos/comunicacao/modelos';
import { notificar } from '@/modulos/comunicacao/notificar';
import { descreverPeriodo } from './calendario';

export type ResultadoExpiracao = { aprovacao: number; pagamento: number };

type Expirada = { id: string; profissionalId: string; inicio: Date; fim: Date };

/**
 * Libera os horários cujo prazo venceu (D3):
 * - pedido sem aprovação até `prazo_aprovacao_ate`;
 * - pedido aprovado sem pagamento até `prazo_pagamento_ate` (a cobrança também expira).
 * A mudança de estado e a liberação do horário acontecem na mesma transação, e a condição no
 * WHERE faz cada reserva expirar uma única vez, mesmo com dois processos rodando juntos.
 * O e-mail ao Profissional é registrado em `notificacao` e nunca sai em dobro.
 */
export async function expirarPrazos(agora = new Date()): Promise<ResultadoExpiracao> {
  const { semAprovacao, semPagamento } = await db.transaction(async (tx) => {
    // Ocorrência de série aprovada cuja cobrança nunca chegou a ser gerada (worker parado, por exemplo) e que
    // já está perto demais do início para ser cobrada: o horário é liberado em vez de ficar retido sem dono.
    const semCobranca: Expirada[] = await tx
      .select({ id: schema.reserva.id, profissionalId: schema.reserva.profissionalId, inicio: schema.reserva.inicio, fim: schema.reserva.fim })
      .from(schema.reserva)
      .innerJoin(schema.regraEspaco, eq(schema.regraEspaco.espacoId, schema.reserva.espacoId))
      .where(
        and(
          eq(schema.reserva.status, 'aprovada'),
          sql`${schema.reserva.inicio} - make_interval(hours => ${schema.regraEspaco.corteAntesInicioHoras}) <= ${agora}`,
        ),
      );
    const idsSemCobranca = semCobranca.map((r) => r.id);
    const expiradasSemCobranca = idsSemCobranca.length
      ? await tx
          .update(schema.reserva)
          .set({ status: 'expirada' })
          .where(and(inArray(schema.reserva.id, idsSemCobranca), eq(schema.reserva.status, 'aprovada')))
          .returning({ id: schema.reserva.id })
      : [];
    const liberadas = new Set(expiradasSemCobranca.map((r) => r.id));

    const semAprovacao: Expirada[] = await tx
      .update(schema.reserva)
      .set({ status: 'expirada' })
      .where(and(eq(schema.reserva.status, 'solicitada'), lte(schema.reserva.prazoAprovacaoAte, agora)))
      .returning({
        id: schema.reserva.id,
        profissionalId: schema.reserva.profissionalId,
        inicio: schema.reserva.inicio,
        fim: schema.reserva.fim,
      });

    const semPagamento: Expirada[] = await tx
      .update(schema.reserva)
      .set({ status: 'expirada' })
      .where(and(eq(schema.reserva.status, 'aguardando_pagamento'), lte(schema.reserva.prazoPagamentoAte, agora)))
      .returning({
        id: schema.reserva.id,
        profissionalId: schema.reserva.profissionalId,
        inicio: schema.reserva.inicio,
        fim: schema.reserva.fim,
      });

    semPagamento.push(...semCobranca.filter((r) => liberadas.has(r.id)));
    const todas = [...semAprovacao, ...semPagamento].map((r) => r.id);
    if (todas.length) await tx.delete(schema.ocupacao).where(inArray(schema.ocupacao.reservaId, todas));

    // O crédito que abateu o pedido volta para a carteira quando o pedido expira sem pagamento.
    for (const r of semPagamento) await devolverUso(tx, r.id, agora);

    if (semPagamento.length) {
      const itens = await tx
        .select({ cobrancaId: schema.cobrancaItem.cobrancaId })
        .from(schema.cobrancaItem)
        .where(inArray(schema.cobrancaItem.reservaId, semPagamento.map((r) => r.id)));
      if (itens.length) {
        const expiradas = await tx
          .update(schema.cobranca)
          .set({ status: 'expirada' })
          .where(and(inArray(schema.cobranca.id, [...new Set(itens.map((i) => i.cobrancaId))]), eq(schema.cobranca.status, 'pendente')))
          .returning({ id: schema.cobranca.id });
        for (const c of expiradas) await devolverUsoDaCobranca(tx, c.id, agora);
      }
    }
    // Uma série cujos pedidos todos expiraram sem aprovação também expira.
    await tx.execute(sql`
      update serie set status = 'expirada'
      where status = 'solicitada'
        and not exists (select 1 from reserva where reserva.serie_id = serie.id and reserva.status = 'solicitada')`);
    return { semAprovacao, semPagamento };
  });

  const avisar = async (lista: Expirada[], etapa: 'aprovacao' | 'pagamento') => {
    for (const r of lista) {
      await registrarAuditoria({ usuarioId: null, acao: `reserva_expirada_${etapa}`, entidade: 'reserva', entidadeId: r.id });
      const [u] = await db
        .select({ nome: schema.usuario.name, email: schema.usuario.email })
        .from(schema.usuario)
        .where(eq(schema.usuario.id, r.profissionalId));
      if (!u) continue;
      const m = emailReservaExpirada({ nome: u.nome, periodo: descreverPeriodo(r.inicio, r.fim), etapa });
      await notificar({
        usuarioId: r.profissionalId,
        para: u.email,
        tipo: 'reserva_expirada',
        assunto: m.assunto,
        html: m.html,
        referenciaTipo: 'reserva',
        referenciaId: r.id,
      });
    }
  };
  await avisar(semAprovacao, 'aprovacao');
  await avisar(semPagamento, 'pagamento');

  return { aprovacao: semAprovacao.length, pagamento: semPagamento.length };
}
