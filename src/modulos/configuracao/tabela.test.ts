import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool, schema } from '@/db';
import { fabrica } from '@/test/fabrica';
import { carregarTabelaPrecos } from './precos';
import { carregarPrecosParaTela, carregarTurnosParaTela, salvarPrecos, salvarTurnos, validarTurnos, type TurnoEditavel } from './tabela';

const f = fabrica();
afterAll(async () => {
  await f.limpar();
  await pool.end();
});

const dataFutura = (dias: number) => new Date(Date.now() + dias * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

describe('preços', () => {
  it('muda o preço de agora em diante, mantém o histórico e registra na auditoria', async () => {
    const { espacoId, turno1, turno2 } = await f.sala();
    const anf = await f.anfitriao();
    const r = await salvarPrecos(espacoId, anf, { hora: '60', dia: '450', turnos: { [turno1]: '200', [turno2]: '320,50' } }, '203.0.113.4');
    expect(r).toMatchObject({ ok: true, mudancas: 2, agendado: false });

    const tabela = await carregarTabelaPrecos(espacoId);
    expect(tabela.horaCentavos).toBe(6000);
    expect(tabela.diaCentavos).toBe(45000);
    expect(tabela.turnos.find((t) => t.id === turno2)?.centavos).toBe(32050);
    expect(tabela.turnos.find((t) => t.id === turno1)?.centavos).toBe(20000);

    const historico = await db.select().from(schema.preco).where(and(eq(schema.preco.espacoId, espacoId), eq(schema.preco.unidade, 'hora')));
    expect(historico.map((p) => p.valorCentavos).sort()).toEqual([5000, 6000]);

    const [ev] = await db.select().from(schema.eventoAuditoria).where(and(eq(schema.eventoAuditoria.entidadeId, espacoId), eq(schema.eventoAuditoria.acao, 'precos_alterados')));
    expect(ev.usuarioId).toBe(anf);
    expect((ev.dados as { mudancas: unknown[] }).mudancas).toEqual([
      { item: 'hora', antes: 5000, depois: 6000 },
      { item: 'turno:Turno 2', antes: 30000, depois: 32050 },
    ]);
  });

  it('não grava nem audita quando nada mudou', async () => {
    const { espacoId, turno1, turno2 } = await f.sala();
    const anf = await f.anfitriao();
    const r = await salvarPrecos(espacoId, anf, { hora: '50', dia: '450', turnos: { [turno1]: '200', [turno2]: '300' } });
    expect(r).toMatchObject({ ok: true, mudancas: 0 });
    expect(await db.select().from(schema.eventoAuditoria).where(eq(schema.eventoAuditoria.entidadeId, espacoId))).toHaveLength(0);
  });

  it('agenda o preço para uma data futura: o de hoje continua valendo até lá', async () => {
    const { espacoId, turno1, turno2 } = await f.sala();
    const anf = await f.anfitriao();
    const r = await salvarPrecos(espacoId, anf, { hora: '70', dia: '450', turnos: { [turno1]: '200', [turno2]: '300' }, desde: dataFutura(10) });
    expect(r).toMatchObject({ ok: true, mudancas: 1, agendado: true });

    expect((await carregarTabelaPrecos(espacoId)).horaCentavos).toBe(5000);
    const tela = await carregarPrecosParaTela(espacoId);
    expect(tela.hora.vigenteCentavos).toBe(5000);
    expect(tela.hora.agendado?.centavos).toBe(7000);
  });

  it('salvar de novo para a mesma data troca o que estava agendado; voltar ao valor atual cancela o agendamento', async () => {
    const { espacoId, turno1, turno2 } = await f.sala();
    const anf = await f.anfitriao();
    const base = { dia: '450', turnos: { [turno1]: '200', [turno2]: '300' } };
    await salvarPrecos(espacoId, anf, { ...base, hora: '70', desde: dataFutura(10) });
    await salvarPrecos(espacoId, anf, { ...base, hora: '75', desde: dataFutura(10) });
    expect((await carregarPrecosParaTela(espacoId)).hora.agendado?.centavos).toBe(7500);
    expect(await db.select().from(schema.preco).where(and(eq(schema.preco.espacoId, espacoId), eq(schema.preco.unidade, 'hora')))).toHaveLength(2);

    await salvarPrecos(espacoId, anf, { ...base, hora: '50' });
    expect((await carregarPrecosParaTela(espacoId)).hora.agendado).toBeNull();
    expect(await db.select().from(schema.preco).where(and(eq(schema.preco.espacoId, espacoId), eq(schema.preco.unidade, 'hora')))).toHaveLength(1);
  });

  it.each([
    [{ hora: '0' }, 'valor'],
    [{ hora: '-5' }, 'valor'],
    [{ hora: 'abc' }, 'valor'],
    [{ hora: '50,555' }, 'valor'],
    [{ hora: '200000' }, 'valor'],
    [{ desde: '2020-01-01' }, 'data'],
    [{ desde: '2026-02-30' }, 'data'],
    [{ desde: dataFutura(400) }, 'data'],
  ])('recusa %j com "%s" e não grava nada', async (ajuste, erro) => {
    const { espacoId, turno1, turno2 } = await f.sala();
    const anf = await f.anfitriao();
    const r = await salvarPrecos(espacoId, anf, { hora: '55', dia: '450', turnos: { [turno1]: '200', [turno2]: '300' }, ...ajuste });
    expect(r).toEqual({ ok: false, erro });
    expect(await db.select().from(schema.preco).where(eq(schema.preco.espacoId, espacoId))).toHaveLength(4);
  });

  it('recusa preço de turno que não é da sala', async () => {
    const { espacoId, turno1 } = await f.sala();
    const outra = await f.sala();
    const anf = await f.anfitriao();
    const r = await salvarPrecos(espacoId, anf, { hora: '50', dia: '450', turnos: { [turno1]: '200', [outra.turno1]: '10' } });
    expect(r).toEqual({ ok: false, erro: 'valor' });
  });
});

describe('validar turnos', () => {
  const t = (nome: string, inicio: number, fim: number, ativo = true): TurnoEditavel => ({ id: nome, nome, inicio, fim, ativo });
  const manha = t('Manhã', 7, 12);
  const tarde = t('Tarde', 13, 22);

  it.each([
    [[manha, tarde], null, null],
    [[manha, tarde, t('Noite', 22, 24, false)], null, null],
    [[manha, t('  ', 13, 22)], null, 'nome'],
    [[manha, t('x'.repeat(41), 13, 22)], null, 'nome'],
    [[manha, t('Tarde', 15, 15)], null, 'horario'],
    [[manha, t('Tarde', 18, 13)], null, 'horario'],
    [[manha, t('Tarde', 11, 22)], null, 'sobreposicao'],
    [[t('Madrugada', 5, 9), tarde], null, 'funcionamento'],
    [[manha, t('Tarde', 13, 23)], null, 'funcionamento'],
    [[t('Manhã', 7, 12, false), t('Tarde', 13, 22, false)], null, 'sem_turno'],
    [[manha, tarde], { nome: 'Almoço', inicio: 12, fim: 13, valor: '80' }, null],
    [[manha, tarde], { nome: 'Almoço', inicio: 12, fim: 14, valor: '80' }, 'sobreposicao'],
    [[manha, tarde], { nome: 'Almoço', inicio: 12, fim: 13, valor: '0' }, 'valor'],
  ])('turnos %# resulta em %s', (turnos, novo, esperado) => {
    expect(validarTurnos(turnos as TurnoEditavel[], novo, 7, 22)).toBe(esperado);
  });

  it('um turno inativo pode sobrepor outro e ficar fora do funcionamento', () => {
    expect(validarTurnos([manha, tarde, t('Antigo', 6, 14, false)], null, 7, 22)).toBeNull();
  });
});

describe('salvar turnos', () => {
  it('renomeia, muda o horário e desativa, e audita só o que mudou', async () => {
    const { espacoId, turno1, turno2 } = await f.sala();
    const anf = await f.anfitriao();
    const r = await salvarTurnos(espacoId, anf, [
      { id: turno1, nome: 'Manhã', inicio: 8, fim: 12, ativo: true },
      { id: turno2, nome: 'Turno 2', inicio: 13, fim: 22, ativo: false },
    ], null, '203.0.113.5');
    expect(r).toEqual({ ok: true, mudancas: 2 });

    const lista = await carregarTurnosParaTela(espacoId);
    expect(lista.find((x) => x.id === turno1)).toMatchObject({ nome: 'Manhã', inicio: 8, fim: 12, ativo: true });
    expect(lista.find((x) => x.id === turno2)?.ativo).toBe(false);
    // desativar um turno tira o preço dele da tabela vigente, sem apagar o histórico
    expect((await carregarTabelaPrecos(espacoId)).turnos.map((x) => x.id)).toEqual([turno1]);
    expect(await db.select().from(schema.preco).where(eq(schema.preco.turnoId, turno2))).toHaveLength(1);

    const [ev] = await db.select().from(schema.eventoAuditoria).where(and(eq(schema.eventoAuditoria.entidadeId, espacoId), eq(schema.eventoAuditoria.acao, 'turnos_alterados')));
    expect(ev.usuarioId).toBe(anf);
  });

  it('cria um turno novo já com o preço, e a tabela vigente o inclui', async () => {
    const { espacoId, turno1, turno2 } = await f.sala({ fecha: '23:00' });
    const anf = await f.anfitriao();
    const r = await salvarTurnos(espacoId, anf, [
      { id: turno1, nome: 'Turno 1', inicio: 7, fim: 12, ativo: true },
      { id: turno2, nome: 'Turno 2', inicio: 13, fim: 22, ativo: true },
    ], { nome: 'Almoço', inicio: 12, fim: 13, valor: '65,90' });
    expect(r).toEqual({ ok: true, mudancas: 1 });

    const tabela = await carregarTabelaPrecos(espacoId);
    expect(tabela.turnos.map((x) => [x.nome, x.inicio, x.fim, x.centavos])).toEqual([
      ['Turno 1', 7, 12, 20000],
      ['Almoço', 12, 13, 6590],
      ['Turno 2', 13, 22, 30000],
    ]);
  });

  it('recusa e não grava nada quando a lista é inválida ou não é a da sala', async () => {
    const { espacoId, turno1, turno2 } = await f.sala();
    const outra = await f.sala();
    const anf = await f.anfitriao();
    expect(await salvarTurnos(espacoId, anf, [
      { id: turno1, nome: 'Turno 1', inicio: 7, fim: 14, ativo: true },
      { id: turno2, nome: 'Turno 2', inicio: 13, fim: 22, ativo: true },
    ], null)).toEqual({ ok: false, erro: 'sobreposicao' });
    expect(await salvarTurnos(espacoId, anf, [
      { id: turno1, nome: 'Turno 1', inicio: 7, fim: 12, ativo: true },
      { id: outra.turno2, nome: 'Turno 2', inicio: 13, fim: 22, ativo: true },
    ], null)).toEqual({ ok: false, erro: 'invalido' });
    expect((await carregarTurnosParaTela(espacoId)).map((x) => [x.inicio, x.fim])).toEqual([[7, 12], [13, 22]]);
  });
});
