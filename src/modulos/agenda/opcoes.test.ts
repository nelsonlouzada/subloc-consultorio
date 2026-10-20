import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool, schema } from '@/db';
import { instanteLocal } from '@/lib/fuso';
import { criarBloqueio } from './bloqueio';
import { opcoesDoDia } from './opcoes';
import { registrarOcupacao } from './ocupacao';

// Segunda 02/11/2026; "agora" 13 dias antes.
const agora = instanteLocal(2026, 10, 20, 12);
const segunda = { ano: 2026, mes: 11, dia: 2 };
const domingo = { ano: 2026, mes: 11, dia: 1 };
const h = (hora: number) => instanteLocal(2026, 11, 2, hora);

const usuarioId = `teste-opc-${randomUUID()}`;
let espacoId: string;

beforeAll(async () => {
  await db.insert(schema.usuario).values({ id: usuarioId, name: 'Teste Opc', email: `${usuarioId}@example.com` });
  await db.insert(schema.profissional).values({
    usuarioId,
    cpf: `6${randomUUID().replace(/\D/g, '').padEnd(10, '0').slice(0, 10)}`,
    profissao: 'psicologo',
    conselho: 'CRP',
    registroNumero: '1',
    registroUf: 'SP',
    status: 'aprovado',
  });
  const [e] = await db.insert(schema.espaco).values({ nome: 'Sala', slug: `teste-${randomUUID()}` }).returning({ id: schema.espaco.id });
  espacoId = e.id;
  await db.insert(schema.regraEspaco).values({
    espacoId,
    diasFuncionamento: [1, 2, 3, 4, 5, 6],
    abre: '07:00',
    fecha: '22:00',
    antecedenciaMinHoras: 24,
    antecedenciaMaxDias: 60,
    duracaoMinHoras: 1,
    travaMinutos: 60,
    prazoAprovacaoHoras: 12,
    prazoPagamentoHoras: 2,
    corteAntesInicioHoras: 6,
    validadeCreditoDias: 90,
    descontoPacoteMesPct: 10,
    avisoRenovacaoSerieDias: 7,
    horaLembreteVespera: '18:00',
  });
  const [t1, t2] = await db
    .insert(schema.turno)
    .values([
      { espacoId, nome: 'Turno 1', inicio: '07:00', fim: '12:00', ordem: 1 },
      { espacoId, nome: 'Turno 2', inicio: '13:00', fim: '22:00', ordem: 2 },
    ])
    .returning({ id: schema.turno.id });
  await db.insert(schema.preco).values([
    { espacoId, unidade: 'hora', valorCentavos: 5000 },
    { espacoId, unidade: 'turno', turnoId: t1.id, valorCentavos: 20000 },
    { espacoId, unidade: 'turno', turnoId: t2.id, valorCentavos: 30000 },
    { espacoId, unidade: 'dia', valorCentavos: 45000 },
  ]);
  // Outra pessoa (prof:A) com 9h-10h, e uma folga (indisponível) das 15h às 16h.
  await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(schema.reserva)
      .values({ espacoId, profissionalId: usuarioId, inicio: h(9), fim: h(10), unidade: 'hora', valorCheioCentavos: 5000, valorCentavos: 5000 })
      .returning({ id: schema.reserva.id });
    await registrarOcupacao(tx, { espacoId, inicio: h(9), fim: h(10), ocupante: 'prof:A', geraTrava: true, travaMinutos: 60, reservaId: r.id });
  });
  await criarBloqueio({ espacoId, tipo: 'indisponivel', inicio: h(15), fim: h(16), criadoPor: usuarioId, travaMinutos: 60 });
});

afterAll(async () => {
  await db.delete(schema.espaco).where(eq(schema.espaco.id, espacoId));
  await db.delete(schema.profissional).where(eq(schema.profissional.usuarioId, usuarioId));
  await db.delete(schema.usuario).where(eq(schema.usuario.id, usuarioId));
  await pool.end();
});

describe('opções do dia para outro Profissional', () => {
  it('mostra cada hora com o motivo quando não dá', async () => {
    const o = (await opcoesDoDia(espacoId, 'outro-prof', segunda, agora))!;
    const motivo = (hora: number) => o.horas.find((x) => x.hora === hora)!.motivo;
    expect(o.horas).toHaveLength(15);
    expect(motivo(7)).toBeNull();
    expect(motivo(8)).toBe('trava'); // colada em 9h
    expect(motivo(9)).toBe('ocupado');
    expect(motivo(10)).toBe('trava'); // colada em 9h-10h
    expect(motivo(11)).toBeNull();
    expect(motivo(15)).toBe('ocupado'); // folga
    expect(motivo(14)).toBeNull(); // folga sem trava: a hora vizinha está livre
    expect(motivo(16)).toBeNull();
  });

  it('as horas finais só vão até a próxima hora ocupada', async () => {
    const o = (await opcoesDoDia(espacoId, 'outro-prof', segunda, agora))!;
    expect(o.fimsPorInicio[11]).toEqual([12, 13, 14, 15]); // para antes da folga das 15h
    expect(o.fimsPorInicio[9]).toBeUndefined(); // 9h está ocupada
    expect(o.fimsPorInicio[7]).toEqual([8]); // 7h-8h cabe; 7h-9h não, porque a hora das 8h fica na trava
  });

  it('turnos e dia inteiro ficam indisponíveis com o motivo, e mostram o preço', async () => {
    const o = (await opcoesDoDia(espacoId, 'outro-prof', segunda, agora))!;
    expect(o.turnos.map((t) => [t.nome, t.centavos, t.motivo])).toEqual([
      ['Turno 1', 20000, 'ocupado'],
      ['Turno 2', 30000, 'ocupado'],
    ]);
    expect(o.diaInteiro).toMatchObject({ centavos: 45000, motivo: 'ocupado' });
  });

  it('o próprio dono do pedido emenda horas sem trava', async () => {
    const o = (await opcoesDoDia(espacoId, 'A', segunda, agora))!;
    expect(o.horas.find((x) => x.hora === 10)!.motivo).toBeNull(); // 'prof:A' emenda 9h-10h com 10h-11h
  });

  it('domingo é fechado', async () => {
    const o = (await opcoesDoDia(espacoId, 'outro-prof', domingo, agora))!;
    expect(o.aberto).toBe(false);
    expect(o.horas.every((x) => x.motivo === 'fechado')).toBe(true);
  });

  it('dia sem nada marcado oferece turnos e dia inteiro', async () => {
    const o = (await opcoesDoDia(espacoId, 'outro-prof', { ano: 2026, mes: 11, dia: 3 }, agora))!;
    expect(o.turnos.every((t) => t.motivo === null)).toBe(true);
    expect(o.diaInteiro.motivo).toBeNull();
    expect(o.fimsPorInicio[7]).toHaveLength(15);
  });
});
