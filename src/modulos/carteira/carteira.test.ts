import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool, schema } from '@/db';
import { instanteLocal } from '@/lib/fuso';
import { fabrica } from '@/test/fabrica';
import { carteiraDoProfissional, concederCredito, saldoDisponivel, usarCredito, vencerLotes } from './carteira';

const f = fabrica();
const agora = instanteLocal(2026, 10, 20, 12);
const DIA = 86_400_000;
const depois = (dias: number) => new Date(agora.getTime() + dias * DIA);

afterAll(async () => {
  await f.limpar();
  await pool.end();
});

const lotes = (prof: string) =>
  db.select().from(schema.creditoLote).where(eq(schema.creditoLote.profissionalId, prof)).orderBy(schema.creditoLote.validadeAte);
const usar = (prof: string, ate: number, quando = agora) => db.transaction((tx) => usarCredito(tx, { profissionalId: prof, ate }, quando));

describe('carteira de créditos', () => {
  it('o lote nasce com a validade da sala e entra no saldo e no extrato', async () => {
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    const lote = await concederCredito(db, { profissionalId: prof, espacoId, origem: 'ajuste_manual', valorCentavos: 5000 }, agora);
    const [regra] = await db.select().from(schema.regraEspaco).where(eq(schema.regraEspaco.espacoId, espacoId));
    expect(lote.validadeAte.getTime()).toBe(depois(regra.validadeCreditoDias).getTime());
    expect(await saldoDisponivel(prof, agora)).toBe(5000);
    const c = await carteiraDoProfissional(prof, agora);
    expect(c.saldoCentavos).toBe(5000);
    expect(c.extrato).toMatchObject([{ tipo: 'entrada', valorCentavos: 5000, origem: 'ajuste_manual' }]);
  });

  it('valor inválido é recusado', async () => {
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    for (const v of [0, -100, 10.5]) {
      await expect(concederCredito(db, { profissionalId: prof, espacoId, origem: 'ajuste_manual', valorCentavos: v })).rejects.toThrow(RangeError);
    }
  });

  it('o uso consome primeiro o lote que vence antes, mesmo criado depois (D8)', async () => {
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    const tarde = await concederCredito(db, { profissionalId: prof, espacoId, origem: 'ajuste_manual', valorCentavos: 3000 }, agora);
    const cedo = await concederCredito(db, { profissionalId: prof, espacoId, origem: 'ajuste_manual', valorCentavos: 2000 }, depois(-30));

    expect(await usar(prof, 2500)).toBe(2500);
    const [a, b] = await lotes(prof);
    expect(a.id).toBe(cedo.id);
    expect(a.saldoCentavos).toBe(0);
    expect(b.id).toBe(tarde.id);
    expect(b.saldoCentavos).toBe(2500);

    const mov = await db.select().from(schema.creditoMovimento).where(eq(schema.creditoMovimento.tipo, 'uso'));
    expect(mov.filter((m) => [cedo.id, tarde.id].includes(m.loteId)).map((m) => m.valorCentavos).sort()).toEqual([-2000, -500]);
  });

  it('usa só até o saldo e devolve o quanto realmente usou; lote vencido não conta', async () => {
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    await concederCredito(db, { profissionalId: prof, espacoId, origem: 'ajuste_manual', valorCentavos: 1000 }, depois(-200)); // vencido
    await concederCredito(db, { profissionalId: prof, espacoId, origem: 'ajuste_manual', valorCentavos: 1500 }, agora);
    expect(await saldoDisponivel(prof, agora)).toBe(1500);
    expect(await usar(prof, 9999)).toBe(1500);
    expect(await saldoDisponivel(prof, agora)).toBe(0);
    expect(await usar(prof, 100)).toBe(0);
  });

  it('dois usos ao mesmo tempo nunca gastam o mesmo saldo duas vezes', async () => {
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    await concederCredito(db, { profissionalId: prof, espacoId, origem: 'ajuste_manual', valorCentavos: 5000 }, agora);
    const usos = await Promise.all(Array.from({ length: 8 }, () => usar(prof, 1000)));
    expect(usos.reduce((s, x) => s + x, 0)).toBe(5000);
    expect(await saldoDisponivel(prof, agora)).toBe(0);
    const [l] = await lotes(prof);
    expect(l.saldoCentavos).toBe(0);
  });

  it('vencerLotes zera o saldo vencido e registra o vencimento uma única vez', async () => {
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    const lote = await concederCredito(db, { profissionalId: prof, espacoId, origem: 'cancelamento', valorCentavos: 4000 }, depois(-100));
    expect(await vencerLotes(agora)).toBeGreaterThanOrEqual(1);
    const [depoisDoVencimento] = await lotes(prof);
    expect(depoisDoVencimento.saldoCentavos).toBe(0);
    const mov = await db.select().from(schema.creditoMovimento).where(eq(schema.creditoMovimento.loteId, lote.id));
    expect(mov.map((m) => [m.tipo, m.valorCentavos]).sort()).toEqual([['entrada', 4000], ['vencimento', -4000]]);
    await vencerLotes(agora);
    expect((await db.select().from(schema.creditoMovimento).where(eq(schema.creditoMovimento.loteId, lote.id))).length).toBe(2);
  });
});
