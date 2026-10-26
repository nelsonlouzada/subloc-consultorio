import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { formatarReais } from '@/lib/dinheiro';
import { registrarAuditoria } from '@/modulos/auditoria/auditoria';
import { concederCredito, usarCredito } from '@/modulos/carteira/carteira';
import { emitirReciboSemFalhar } from '@/modulos/cobranca/recibo';
import { emailPagamentoAtrasadoVirouCredito, emailSeriePaga } from '@/modulos/comunicacao/modelos';
import { notificar } from '@/modulos/comunicacao/notificar';
import { descreverPeriodo } from './calendario';
import { ConflitoAgendaError, registrarOcupacao } from './ocupacao';
import { CreditoInsuficienteError, type OrigemPagamento } from './pagamento';
import { EstadoReservaError, ReservaNaoEncontradaError } from './solicitacao';

export type ResultadoPagamentoSerie = {
  /** Datas confirmadas com este pagamento (inclusive as reativadas depois de expirar). */
  confirmadas: number;
  /** Datas que não puderam voltar (horário ocupado, já passou ou cancelada) e viraram crédito. */
  viraramCredito: number;
  creditoCentavos: number;
};

/**
 * "O dinheiro chegou" para uma cobrança com várias datas (pacote do mês, ou uma data por ocorrência
 * de série). Para cada data da cobrança:
 * - esperando pagamento: confirma;
 * - já expirada (pagamento atrasado, T1): tenta reter o horário de novo; se o banco recusar, ou se a
 *   data já passou, o valor daquela data vira crédito integral na carteira;
 * - cancelada ou em qualquer outro estado: o valor daquela data vira crédito.
 * Se o crédito que abatia a cobrança já tinha sido devolvido na expiração, é abatido de novo, ou
 * tudo é desfeito (`CreditoInsuficienteError`). Chamar de novo para uma cobrança paga não faz nada.
 */
export async function confirmarCobrancaDeSerie(
  cobrancaId: string,
  quem: OrigemPagamento,
  opcoes: { ip?: string | null } = {},
  agora = new Date(),
): Promise<ResultadoPagamentoSerie | null> {
  const [c] = await db
    .select({ cobranca: schema.cobranca, nome: schema.usuario.name, email: schema.usuario.email })
    .from(schema.cobranca)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.cobranca.profissionalId))
    .where(eq(schema.cobranca.id, cobrancaId));
  if (!c) throw new ReservaNaoEncontradaError();
  if (c.cobranca.finalidade !== 'ocorrencia' && c.cobranca.finalidade !== 'pacote_mes') throw new EstadoReservaError(c.cobranca.finalidade);
  if (c.cobranca.status === 'paga') return null;

  const itens = await db
    .select({ reserva: schema.reserva, valorCentavos: schema.cobrancaItem.valorCentavos, travaMinutos: schema.regraEspaco.travaMinutos })
    .from(schema.cobrancaItem)
    .innerJoin(schema.reserva, eq(schema.reserva.id, schema.cobrancaItem.reservaId))
    .innerJoin(schema.regraEspaco, eq(schema.regraEspaco.espacoId, schema.reserva.espacoId))
    .where(eq(schema.cobrancaItem.cobrancaId, cobrancaId))
    .orderBy(schema.reserva.inicio);
  if (itens.length === 0) throw new ReservaNaoEncontradaError();
  const espacoId = itens[0].reserva.espacoId;
  const profissionalId = c.cobranca.profissionalId;
  const atrasado = c.cobranca.status !== 'pendente';

  const aplicar = () => db.transaction(async (tx) => {
    // Só uma confirmação por cobrança: a condição no WHERE impede pagar duas vezes ou competir com a expiração.
    const mudou = await tx
      .update(schema.cobranca)
      .set({ status: 'paga', meio: quem.meio, marcadaPagaPor: quem.usuarioId, pagoEm: agora })
      .where(and(eq(schema.cobranca.id, cobrancaId), inArray(schema.cobranca.status, ['pendente', 'expirada', 'cancelada'])))
      .returning({ id: schema.cobranca.id });
    if (mudou.length === 0) throw new EstadoReservaError('já decidida');

    // Cobrança que expirou devolveu o crédito que a abatia: abate de novo, ou desfaz tudo.
    if (c.cobranca.status !== 'pendente' && c.cobranca.creditoUsadoCentavos > 0) {
      const usado = await usarCredito(tx, { profissionalId, ate: c.cobranca.creditoUsadoCentavos, cobrancaId }, agora);
      if (usado < c.cobranca.creditoUsadoCentavos) throw new CreditoInsuficienteError();
    }

    let confirmadas = 0;
    let viraramCredito = 0;
    let creditoCentavos = 0;
    for (const item of itens) {
      const r = item.reserva;
      let confirmou = false;
      if (r.status === 'aguardando_pagamento') {
        const ok = await tx
          .update(schema.reserva)
          .set({ status: 'confirmada' })
          .where(and(eq(schema.reserva.id, r.id), eq(schema.reserva.status, 'aguardando_pagamento')))
          .returning({ id: schema.reserva.id });
        confirmou = ok.length > 0;
      } else if (r.status === 'expirada' && r.inicio > agora) {
        try {
          // O ponto de salvamento deixa o resto da cobrança seguir se só este horário foi tomado por outra pessoa.
          await tx.transaction(async (sp) => {
            await registrarOcupacao(sp, {
              espacoId,
              inicio: r.inicio,
              fim: r.fim,
              ocupante: `prof:${profissionalId}`,
              geraTrava: true,
              travaMinutos: item.travaMinutos,
              reservaId: r.id,
            });
            await sp.update(schema.reserva).set({ status: 'confirmada' }).where(and(eq(schema.reserva.id, r.id), eq(schema.reserva.status, 'expirada')));
          });
          confirmou = true;
        } catch (e) {
          if (!(e instanceof ConflitoAgendaError)) throw e;
        }
      }
      if (confirmou) {
        confirmadas++;
      } else if (item.valorCentavos > 0) {
        await concederCredito(
          tx,
          { profissionalId, espacoId, origem: 'pagamento_atrasado', valorCentavos: item.valorCentavos, reservaId: r.id, cobrancaId, criadoPor: quem.usuarioId },
          agora,
        );
        viraramCredito++;
        creditoCentavos += item.valorCentavos;
      }
    }
    return { confirmadas, viraramCredito, creditoCentavos };
  });

  // Sem saldo para abater o crédito de novo, nada se confirma: o dinheiro que chegou vira crédito integral (e o
  // aviso do Asaas, que não pode falhar para sempre, é tratado).
  const tudoViraCredito = () =>
    db.transaction(async (tx) => {
      const mudou = await tx
        .update(schema.cobranca)
        .set({ status: 'paga', meio: quem.meio, marcadaPagaPor: quem.usuarioId, pagoEm: agora })
        .where(and(eq(schema.cobranca.id, cobrancaId), inArray(schema.cobranca.status, ['pendente', 'expirada', 'cancelada'])))
        .returning({ id: schema.cobranca.id });
      if (mudou.length === 0) throw new EstadoReservaError('já decidida');
      const valor = c.cobranca.valorCobradoCentavos;
      if (valor > 0) await concederCredito(tx, { profissionalId, espacoId, origem: 'pagamento_atrasado', valorCentavos: valor, cobrancaId, criadoPor: quem.usuarioId }, agora);
      return { confirmadas: 0, viraramCredito: itens.length, creditoCentavos: valor };
    });

  let resultado: ResultadoPagamentoSerie;
  try {
    resultado = await aplicar();
  } catch (e) {
    if (!(e instanceof CreditoInsuficienteError)) throw e;
    resultado = await tudoViraCredito();
  }

  await emitirReciboSemFalhar(cobrancaId);
  await registrarAuditoria({
    usuarioId: quem.usuarioId,
    acao: atrasado ? 'pagamento_serie_atrasado' : 'pagamento_serie_marcado',
    // Fica no histórico da série (que é o que o Anfitrião consulta); a cobrança vai nos dados.
    entidade: 'serie',
    entidadeId: itens[0].reserva.serieId ?? cobrancaId,
    dados: { ...resultado, cobrancaId, valorCentavos: c.cobranca.valorCobradoCentavos, meio: quem.meio },
    ip: opcoes.ip ?? null,
  });

  const periodos = itens.map((i) => descreverPeriodo(i.reserva.inicio, i.reserva.fim));
  if (resultado.confirmadas > 0) {
    const m = emailSeriePaga({ nome: c.nome, valor: formatarReais(c.cobranca.valorCobradoCentavos), periodos, confirmadas: resultado.confirmadas, serieId: itens[0].reserva.serieId });
    await notificar({ usuarioId: profissionalId, para: c.email, tipo: 'serie_paga', assunto: m.assunto, html: m.html, referenciaTipo: 'cobranca', referenciaId: cobrancaId });
  }
  if (resultado.viraramCredito > 0) {
    const m = emailPagamentoAtrasadoVirouCredito({ nome: c.nome, periodo: `${resultado.viraramCredito} ${resultado.viraramCredito === 1 ? 'data' : 'datas'} da série`, valor: formatarReais(resultado.creditoCentavos) });
    await notificar({ usuarioId: profissionalId, para: c.email, tipo: 'serie_paga_credito', assunto: m.assunto, html: m.html, referenciaTipo: 'cobranca', referenciaId: cobrancaId });
  }
  return resultado;
}

/** O Anfitrião confere o Pix de uma cobrança de série e marca como recebido (a mesma regra do Asaas). */
export async function marcarPagoCobrancaDeSerie(cobrancaId: string, anfitriaoId: string, opcoes: { ip?: string | null } = {}, agora = new Date()) {
  return confirmarCobrancaDeSerie(cobrancaId, { usuarioId: anfitriaoId, meio: 'pix_manual' }, opcoes, agora);
}
