import { and, asc, desc, eq, lte } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { TabelaPrecos } from '@/modulos/agenda/preco';
import { horaInteira } from './espaco';

/**
 * Tabela de preços vigente: para cada unidade (hora, dia e cada turno ativo), o preço mais
 * recente que já começou a valer. Preços com `vigente_desde` no futuro ficam de fora.
 */
export async function carregarTabelaPrecos(espacoId: string, agora = new Date()): Promise<TabelaPrecos> {
  const turnos = await db
    .select()
    .from(schema.turno)
    .where(and(eq(schema.turno.espacoId, espacoId), eq(schema.turno.ativo, true)))
    .orderBy(asc(schema.turno.ordem));

  const precos = await db
    .select()
    .from(schema.preco)
    .where(and(eq(schema.preco.espacoId, espacoId), lte(schema.preco.vigenteDesde, agora)))
    .orderBy(desc(schema.preco.vigenteDesde));

  // A lista vem do mais novo para o mais antigo: o primeiro de cada chave é o vigente.
  const vigente = (unidade: 'hora' | 'turno' | 'dia', turnoId: string | null = null) => {
    const p = precos.find((x) => x.unidade === unidade && x.turnoId === turnoId);
    if (!p) throw new Error(`Tabela de preços incompleta: falta o preço de "${unidade}"${turnoId ? ' de um turno' : ''}.`);
    return p.valorCentavos;
  };

  return {
    horaCentavos: vigente('hora'),
    diaCentavos: vigente('dia'),
    turnos: turnos.map((t) => ({
      id: t.id,
      nome: t.nome,
      inicio: horaInteira(t.inicio),
      fim: horaInteira(t.fim),
      centavos: vigente('turno', t.id),
    })),
  };
}
