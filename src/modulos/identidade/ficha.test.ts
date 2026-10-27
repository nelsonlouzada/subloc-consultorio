import { afterAll, describe, expect, it } from 'vitest';
import { db, pool, schema } from '@/db';
import { instanteLocal } from '@/lib/fuso';
import { fabrica } from '@/test/fabrica';
import { reservasDaFicha } from './ficha';

const f = fabrica();
afterAll(async () => {
  await f.limpar();
  await pool.end();
});

const agora = instanteLocal(2032, 3, 15, 12);
const dia = (d: number, h: number) => instanteLocal(2032, 3, d, h);

async function reserva(espacoId: string, prof: string, d: number, status: typeof schema.reserva.$inferInsert.status, extra: Partial<typeof schema.reserva.$inferInsert> = {}) {
  const [r] = await db
    .insert(schema.reserva)
    .values({ espacoId, profissionalId: prof, inicio: dia(d, 9), fim: dia(d, 10), unidade: 'hora', valorCheioCentavos: 5000, valorCentavos: 5000, status, ...extra })
    .returning({ id: schema.reserva.id });
  return r.id;
}

describe('reservas da ficha', () => {
  it('separa o que ainda vem do que já passou, em ordem, e conta por situação', async () => {
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    const outra = await f.profissional();

    const futura2 = await reserva(espacoId, prof, 20, 'confirmada');
    const futura1 = await reserva(espacoId, prof, 17, 'aguardando_pagamento');
    const pedido = await reserva(espacoId, prof, 25, 'solicitada');
    const serie = await reserva(espacoId, prof, 27, 'aprovada');
    const emAndamento = await reserva(espacoId, prof, 15, 'confirmada', { inicio: dia(15, 11), fim: dia(15, 13) }); // começou e ainda não acabou
    const feita = await reserva(espacoId, prof, 10, 'realizada');
    const faltou = await reserva(espacoId, prof, 12, 'falta');
    const cancelada = await reserva(espacoId, prof, 22, 'cancelada'); // futura, mas cancelada: não ocupa a sala
    const expirada = await reserva(espacoId, prof, 5, 'expirada');
    await reserva(espacoId, outra, 18, 'confirmada'); // de outra pessoa

    const r = await reservasDaFicha(prof, agora);
    expect(r.proximas.map((x) => x.id)).toEqual([emAndamento, futura1, futura2, pedido, serie]);
    expect(r.recentes.map((x) => x.id)).toEqual([faltou, feita, expirada]); // da mais nova para a mais antiga; a cancelada futura não entra
    expect(r.recentes.map((x) => x.id)).not.toContain(cancelada);
    expect(r.contagens).toEqual({ realizadas: 1, faltas: 1, canceladas: 1, todas: 9 });
  });

  it('limita as listas e não mistura profissionais', async () => {
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    for (let i = 0; i < 12; i++) await reserva(espacoId, prof, 1, 'realizada', { inicio: dia(1, 8 + (i % 8)), fim: dia(1, 9 + (i % 8)) });
    const r = await reservasDaFicha(prof, agora);
    expect(r.recentes).toHaveLength(10);
    expect(r.contagens.realizadas).toBe(12);
    expect(r.proximas).toEqual([]);
    expect(await reservasDaFicha(await f.profissional(), agora)).toEqual({ proximas: [], recentes: [], contagens: { realizadas: 0, faltas: 0, canceladas: 0, todas: 0 } });
  });
});
