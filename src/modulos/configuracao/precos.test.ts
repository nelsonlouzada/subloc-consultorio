import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool, schema } from '@/db';
import { instanteLocal } from '@/lib/fuso';
import { calcularPreco } from '@/modulos/agenda/preco';
import { carregarTabelaPrecos } from './precos';

const espacos: string[] = [];

async function salaComPrecos(): Promise<{ espacoId: string; turno1: string; turno2: string }> {
  const [e] = await db
    .insert(schema.espaco)
    .values({ nome: 'Sala de teste', slug: `teste-${randomUUID()}` })
    .returning({ id: schema.espaco.id });
  espacos.push(e.id);
  const [t1, t2] = await db
    .insert(schema.turno)
    .values([
      { espacoId: e.id, nome: 'Turno 1', inicio: '07:00', fim: '12:00', ordem: 1 },
      { espacoId: e.id, nome: 'Turno 2', inicio: '13:00', fim: '22:00', ordem: 2 },
    ])
    .returning({ id: schema.turno.id });
  await db.insert(schema.preco).values([
    { espacoId: e.id, unidade: 'hora', valorCentavos: 5000 },
    { espacoId: e.id, unidade: 'turno', turnoId: t1.id, valorCentavos: 20000 },
    { espacoId: e.id, unidade: 'turno', turnoId: t2.id, valorCentavos: 30000 },
    { espacoId: e.id, unidade: 'dia', valorCentavos: 45000 },
  ]);
  return { espacoId: e.id, turno1: t1.id, turno2: t2.id };
}

afterAll(async () => {
  for (const id of espacos) await db.delete(schema.espaco).where(eq(schema.espaco.id, id));
  await pool.end();
});

describe('tabela de preços vigente', () => {
  it('lê hora, dia e turnos na ordem, com horas inteiras', async () => {
    const { espacoId } = await salaComPrecos();
    const t = await carregarTabelaPrecos(espacoId);
    expect(t.horaCentavos).toBe(5000);
    expect(t.diaCentavos).toBe(45000);
    expect(t.turnos.map((x) => [x.nome, x.inicio, x.fim, x.centavos])).toEqual([
      ['Turno 1', 7, 12, 20000],
      ['Turno 2', 13, 22, 30000],
    ]);
  });

  it('alimenta o cálculo do menor preço', async () => {
    const { espacoId } = await salaComPrecos();
    const t = await carregarTabelaPrecos(espacoId);
    const r = calcularPreco(instanteLocal(2026, 11, 2, 9), instanteLocal(2026, 11, 2, 14), t);
    expect(r.valorCentavos).toBe(25000);
  });

  it('vale o preço mais recente que já começou', async () => {
    const { espacoId } = await salaComPrecos();
    await db.insert(schema.preco).values({
      espacoId,
      unidade: 'hora',
      valorCentavos: 6000,
      vigenteDesde: new Date(Date.now() + 1000),
    });
    const depois = new Date(Date.now() + 60_000);
    expect((await carregarTabelaPrecos(espacoId, depois)).horaCentavos).toBe(6000);
  });

  it('ignora preço que só passa a valer no futuro', async () => {
    const { espacoId } = await salaComPrecos();
    await db.insert(schema.preco).values({
      espacoId,
      unidade: 'hora',
      valorCentavos: 9900,
      vigenteDesde: new Date(Date.now() + 86_400_000),
    });
    expect((await carregarTabelaPrecos(espacoId)).horaCentavos).toBe(5000);
  });

  it('turno desativado não entra na tabela', async () => {
    const { espacoId, turno2 } = await salaComPrecos();
    await db.update(schema.turno).set({ ativo: false }).where(eq(schema.turno.id, turno2));
    const t = await carregarTabelaPrecos(espacoId);
    expect(t.turnos.map((x) => x.nome)).toEqual(['Turno 1']);
  });

  it('tabela incompleta é erro claro, não preço zero', async () => {
    const { espacoId } = await salaComPrecos();
    await db.delete(schema.preco).where(and(eq(schema.preco.espacoId, espacoId), eq(schema.preco.unidade, 'dia')));
    await expect(carregarTabelaPrecos(espacoId)).rejects.toThrow(/incompleta/);
  });
});
