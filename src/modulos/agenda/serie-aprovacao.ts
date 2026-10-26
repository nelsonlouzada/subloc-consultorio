import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { partesLocais } from '@/lib/fuso';
import { registrarAuditoria } from '@/modulos/auditoria/auditoria';
import { emailSerieAprovada, emailSerieRecusada } from '@/modulos/comunicacao/modelos';
import { notificar } from '@/modulos/comunicacao/notificar';
import { aprovarProfissional, TransicaoInvalidaError } from '@/modulos/identidade/aprovacao';
import { gerarCobrancasDaSerie } from './serie-cobranca';
import { descreverSerie } from './serie';
import { CadastroPendenteError, EstadoReservaError, PrazoVencidoError, ReservaNaoEncontradaError } from './solicitacao';

type Contexto = { ip?: string | null };

async function carregarSerie(serieId: string) {
  const [s] = await db
    .select({
      serie: schema.serie,
      profissionalStatus: schema.profissional.status,
      nome: schema.usuario.name,
      email: schema.usuario.email,
    })
    .from(schema.serie)
    .innerJoin(schema.profissional, eq(schema.profissional.usuarioId, schema.serie.profissionalId))
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.serie.profissionalId))
    .where(eq(schema.serie.id, serieId));
  if (!s) throw new ReservaNaoEncontradaError();
  return s;
}

const resumoDe = (s: typeof schema.serie.$inferSelect, horaInicio: number, horaFim: number) =>
  descreverSerie({ diasSemana: s.diasSemana, frequencia: s.frequencia, horaInicio, horaFim, dataInicio: s.dataInicio, dataFim: s.dataFim });

/** Hora de início e fim da série, lida de uma das ocorrências (vale também para turno e dia inteiro). */
async function horasDaSerie(serieId: string): Promise<{ de: number; ate: number; n: number }> {
  const rs = await db.select({ inicio: schema.reserva.inicio, fim: schema.reserva.fim }).from(schema.reserva).where(eq(schema.reserva.serieId, serieId));
  if (rs.length === 0) return { de: 0, ate: 0, n: 0 };
  return { de: partesLocais(rs[0].inicio).hora, ate: partesLocais(rs[0].fim).hora || 24, n: rs.length };
}

/**
 * Aprova a série inteira: as ocorrências passam a `aprovada` (o horário segue retido) e as cobranças
 * começam a ser geradas: o primeiro mês já, no pacote do mês, ou cada data alguns dias antes, por
 * ocorrência. Cadastro pendente só aprova junto (`aprovarCadastro`), como na aprovação de uma reserva.
 */
export async function aprovarSerie(serieId: string, anfitriaoId: string, opcoes: Contexto & { aprovarCadastro?: boolean } = {}, agora = new Date()) {
  const s = await carregarSerie(serieId);
  if (s.serie.status !== 'solicitada') throw new EstadoReservaError(s.serie.status);
  if (s.profissionalStatus === 'recusado') throw new EstadoReservaError('cadastro recusado');

  const pedidos = await db
    .select({ prazo: schema.reserva.prazoAprovacaoAte })
    .from(schema.reserva)
    .where(and(eq(schema.reserva.serieId, serieId), eq(schema.reserva.status, 'solicitada')));
  if (pedidos.length === 0) throw new EstadoReservaError('sem datas em aberto');
  const prazo = Math.min(...pedidos.map((p) => p.prazo?.getTime() ?? Infinity));
  if (agora.getTime() >= prazo) throw new PrazoVencidoError();

  if (s.profissionalStatus === 'pendente') {
    if (!opcoes.aprovarCadastro) throw new CadastroPendenteError();
    try {
      await aprovarProfissional(s.serie.profissionalId, anfitriaoId, opcoes.ip ?? null);
    } catch (e) {
      // Outra pessoa pode ter aprovado o cadastro no mesmo instante: o objetivo foi atingido.
      if (!(e instanceof TransicaoInvalidaError)) throw e;
    }
  }

  await db.transaction(async (tx) => {
    // A condição no WHERE garante uma única decisão por série, mesmo com dois cliques ao mesmo tempo.
    const mudou = await tx
      .update(schema.serie)
      .set({ status: 'aprovada', aprovadaPor: anfitriaoId, aprovadaEm: agora })
      .where(and(eq(schema.serie.id, serieId), eq(schema.serie.status, 'solicitada')))
      .returning({ id: schema.serie.id });
    if (mudou.length === 0) throw new EstadoReservaError('já decidida');
    await tx
      .update(schema.reserva)
      .set({ status: 'aprovada', aprovadaPor: anfitriaoId, aprovadaEm: agora })
      .where(and(eq(schema.reserva.serieId, serieId), eq(schema.reserva.status, 'solicitada')));
  });

  const { de, ate, n } = await horasDaSerie(serieId);
  await registrarAuditoria({ usuarioId: anfitriaoId, acao: 'serie_aprovada', entidade: 'serie', entidadeId: serieId, dados: { ocorrencias: n }, ip: opcoes.ip ?? null });
  const m = emailSerieAprovada({ nome: s.nome, resumo: resumoDe(s.serie, de, ate), ocorrencias: n, pacote: s.serie.formaPagamento === 'pacote_mes', serieId });
  await notificar({ usuarioId: s.serie.profissionalId, para: s.email, tipo: 'serie_aprovada', assunto: m.assunto, html: m.html, referenciaTipo: 'serie', referenciaId: serieId });

  const cobrancas = await gerarCobrancasDaSerie(serieId, { primeiroGrupo: true }, agora);
  return { ocorrencias: n, cobrancas };
}

/** Recusa a série inteira: todas as datas são liberadas na mesma transação e a pessoa é avisada. */
export async function recusarSerie(serieId: string, anfitriaoId: string, motivo: string | null, opcoes: Contexto = {}, agora = new Date()) {
  const s = await carregarSerie(serieId);
  if (s.serie.status !== 'solicitada') throw new EstadoReservaError(s.serie.status);
  const { de, ate } = await horasDaSerie(serieId);

  await db.transaction(async (tx) => {
    const mudou = await tx
      .update(schema.serie)
      .set({ status: 'recusada', motivoRecusa: motivo, aprovadaPor: anfitriaoId, aprovadaEm: agora })
      .where(and(eq(schema.serie.id, serieId), eq(schema.serie.status, 'solicitada')))
      .returning({ id: schema.serie.id });
    if (mudou.length === 0) throw new EstadoReservaError('já decidida');
    const recusadas = await tx
      .update(schema.reserva)
      .set({ status: 'recusada', motivoRecusa: motivo, aprovadaPor: anfitriaoId, aprovadaEm: agora })
      .where(and(eq(schema.reserva.serieId, serieId), eq(schema.reserva.status, 'solicitada')))
      .returning({ id: schema.reserva.id });
    if (recusadas.length) await tx.delete(schema.ocupacao).where(inArray(schema.ocupacao.reservaId, recusadas.map((r) => r.id)));
  });

  await registrarAuditoria({ usuarioId: anfitriaoId, acao: 'serie_recusada', entidade: 'serie', entidadeId: serieId, dados: { motivo }, ip: opcoes.ip ?? null });
  const m = emailSerieRecusada({ nome: s.nome, resumo: resumoDe(s.serie, de, ate), motivo });
  await notificar({ usuarioId: s.serie.profissionalId, para: s.email, tipo: 'serie_recusada', assunto: m.assunto, html: m.html, referenciaTipo: 'serie', referenciaId: serieId });
}
