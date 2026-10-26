import { desc, eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';
import { partesLocais } from '@/lib/fuso';
import { descreverSerie } from './serie';

export type SerieDetalhada = NonNullable<Awaited<ReturnType<typeof obterSerie>>>;

/** Hora local de início e fim das datas da série, lida da primeira data (vale para hora, turno e dia inteiro). */
function horasDe(reservas: { inicio: Date; fim: Date }[]) {
  if (reservas.length === 0) return { de: 0, ate: 0 };
  const ini = partesLocais(reservas[0].inicio);
  const fim = partesLocais(reservas[0].fim);
  return { de: ini.hora, ate: fim.hora === 0 ? 24 : fim.hora };
}

/** A série com tudo o que as telas de detalhe precisam: datas, cobranças (com as datas de cada uma) e a pessoa. */
export async function obterSerie(serieId: string) {
  const [x] = await db
    .select({
      serie: schema.serie,
      profissionalNome: schema.usuario.name,
      profissionalEmail: schema.usuario.email,
      profissionalStatus: schema.profissional.status,
    })
    .from(schema.serie)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.serie.profissionalId))
    .innerJoin(schema.profissional, eq(schema.profissional.usuarioId, schema.serie.profissionalId))
    .where(eq(schema.serie.id, serieId));
  if (!x) return null;

  const reservas = await db.select().from(schema.reserva).where(eq(schema.reserva.serieId, serieId)).orderBy(schema.reserva.inicio);
  const itens = reservas.length
    ? await db
        .select({ reservaId: schema.cobrancaItem.reservaId, cobranca: schema.cobranca })
        .from(schema.cobrancaItem)
        .innerJoin(schema.cobranca, eq(schema.cobranca.id, schema.cobrancaItem.cobrancaId))
        .where(inArray(schema.cobrancaItem.reservaId, reservas.map((r) => r.id)))
        .orderBy(desc(schema.cobranca.criadoEm))
    : [];

  const porCobranca = new Map<string, { cobranca: typeof schema.cobranca.$inferSelect; reservaIds: string[] }>();
  for (const i of itens) {
    const atual = porCobranca.get(i.cobranca.id) ?? { cobranca: i.cobranca, reservaIds: [] };
    atual.reservaIds.push(i.reservaId!);
    porCobranca.set(i.cobranca.id, atual);
  }
  const { de, ate } = horasDe(reservas);
  const inicioDe = new Map(reservas.map((r) => [r.id, r.inicio.getTime()]));
  return {
    ...x,
    reservas,
    // As datas de cada cobrança, em ordem de calendário.
    cobrancas: [...porCobranca.values()].map((c) => ({ ...c, reservaIds: [...c.reservaIds].sort((a, b) => (inicioDe.get(a) ?? 0) - (inicioDe.get(b) ?? 0)) })),
    descricao: descreverSerie({
      diasSemana: x.serie.diasSemana,
      frequencia: x.serie.frequencia,
      horaInicio: x.serie.horaInicio ?? de,
      horaFim: x.serie.horaFim ?? ate,
      dataInicio: x.serie.dataInicio,
      dataFim: x.serie.dataFim,
    }),
  };
}

/** Séries de um Profissional, das mais recentes para as mais antigas, com quantas datas ainda estão por vir. */
export async function listarSeriesDoProfissional(profissionalId: string, agora = new Date()) {
  const series = await db.select().from(schema.serie).where(eq(schema.serie.profissionalId, profissionalId)).orderBy(desc(schema.serie.criadoEm));
  if (series.length === 0) return [];
  const reservas = await db
    .select({ serieId: schema.reserva.serieId, status: schema.reserva.status, inicio: schema.reserva.inicio, fim: schema.reserva.fim })
    .from(schema.reserva)
    .where(inArray(schema.reserva.serieId, series.map((s) => s.id)));
  return series.map((s) => {
    const dela = reservas.filter((r) => r.serieId === s.id);
    const { de, ate } = horasDe([...dela].sort((a, b) => a.inicio.getTime() - b.inicio.getTime()));
    return {
      ...s,
      ocorrencias: dela.length,
      porVir: dela.filter((r) => r.fim > agora && ['solicitada', 'aprovada', 'aguardando_pagamento', 'confirmada'].includes(r.status)).length,
      descricao: descreverSerie({
        diasSemana: s.diasSemana,
        frequencia: s.frequencia,
        horaInicio: s.horaInicio ?? de,
        horaFim: s.horaFim ?? ate,
        dataInicio: s.dataInicio,
        dataFim: s.dataFim,
      }),
    };
  });
}

export const ROTULO_SERIE: Record<string, { nome: string; cor: string }> = {
  solicitada: { nome: 'Aguardando aprovação', cor: 'bg-amber-100 text-amber-900' },
  aprovada: { nome: 'Aprovada', cor: 'bg-green-100 text-green-900' },
  recusada: { nome: 'Recusada', cor: 'bg-red-100 text-red-900' },
  expirada: { nome: 'Expirada', cor: 'bg-zinc-100 text-zinc-700' },
  encerrada: { nome: 'Encerrada', cor: 'bg-zinc-100 text-zinc-700' },
  cancelada: { nome: 'Cancelada', cor: 'bg-zinc-100 text-zinc-700' },
};
