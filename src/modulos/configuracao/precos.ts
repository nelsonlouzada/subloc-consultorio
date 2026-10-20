import { and, asc, desc, eq, lte, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import type { TabelaPrecos } from '@/modulos/agenda/preco';
import { horaInteira } from './espaco';

/**
 * Tabela de preços vigente: para cada unidade (hora, dia e cada turno ativo), o preço mais
 * recente que já começou a valer. Preços com `vigente_desde` no futuro ficam de fora.
 *
 * Sem `agora`, "já começou" é medido pelo relógio do banco, o mesmo que grava `vigente_desde`.
 * Comparar com o relógio do servidor da aplicação deixaria um preço recém-criado de fora por
 * alguns milissegundos sempre que os dois relógios divergissem.
 */
export async function carregarTabelaPrecos(espacoId: string, agora?: Date): Promise<TabelaPrecos> {
  const turnos = await db
    .select()
    .from(schema.turno)
    .where(and(eq(schema.turno.espacoId, espacoId), eq(schema.turno.ativo, true)))
    .orderBy(asc(schema.turno.ordem));

  const precos = await db
    .select()
    .from(schema.preco)
    .where(
      and(
        eq(schema.preco.espacoId, espacoId),
        agora ? lte(schema.preco.vigenteDesde, agora) : sql`${schema.preco.vigenteDesde} <= now()`,
      ),
    )
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
