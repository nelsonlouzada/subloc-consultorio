import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool, schema } from '@/db';
import { fabrica } from '@/test/fabrica';
import { lerRegras, regrasParaTela, salvarRegras, type Regras } from './regras';

const f = fabrica();
afterAll(async () => {
  await f.limpar();
  await pool.end();
});

const base = {
  diasFuncionamento: ['1', '2', '3', '4', '5', '6'],
  abre: '7',
  fecha: '22',
  antecedenciaMinHoras: '24',
  antecedenciaMaxDias: '60',
  duracaoMinHoras: '1',
  travaMinutos: '60',
  prazoAprovacaoHoras: '12',
  prazoPagamentoHoras: '2',
  corteAntesInicioHoras: '6',
  validadeCreditoDias: '90',
  cancelamentoIntegralHoras: '48',
  cancelamentoParcialHoras: '24',
  cancelamentoParcialPct: '50',
  descontoPacoteMesPct: '10',
  avisoRenovacaoSerieDias: '7',
  horaLembreteVespera: '18',
};
const ler = (ajuste: Record<string, unknown> = {}) => lerRegras({ ...base, ...ajuste });
const regras = (ajuste: Partial<Regras> = {}): Regras => {
  const r = ler();
  if (!r.ok) throw new Error('base inválida');
  return { ...r.regras, ...ajuste };
};

describe('validação das regras', () => {
  it('aceita os valores de partida, lendo números de um formulário', () => {
    const r = ler();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.regras).toMatchObject({ abre: 7, fecha: 22, diasFuncionamento: [1, 2, 3, 4, 5, 6], cancelamentoParcialPct: 50 });
  });

  it('ordena e tira repetidos dos dias', () => {
    const r = ler({ diasFuncionamento: ['5', '1', '5'] });
    expect(r.ok && r.regras.diasFuncionamento).toEqual([1, 5]);
  });

  it.each([
    [{ diasFuncionamento: [] }, 'dias'],
    [{ abre: '10', fecha: '10' }, 'horario'],
    [{ abre: '12', fecha: '9' }, 'horario'],
    [{ cancelamentoIntegralHoras: '12', cancelamentoParcialHoras: '24' }, 'cancelamento'],
    [{ antecedenciaMinHoras: '3', corteAntesInicioHoras: '6' }, 'antecedencia'],
    [{ cancelamentoParcialPct: '101' }, 'invalido'],
    [{ prazoPagamentoHoras: '0' }, 'invalido'],
    [{ abre: 'sete' }, 'invalido'],
    [{ diasFuncionamento: ['8'] }, 'invalido'],
  ])('recusa %j com o motivo "%s"', (ajuste, motivo) => {
    expect(ler(ajuste)).toEqual({ ok: false, erro: motivo });
  });

  it('aceita cancelar integral e parcial no mesmo prazo e parcial de 0%', () => {
    expect(ler({ cancelamentoIntegralHoras: '24', cancelamentoParcialHoras: '24', cancelamentoParcialPct: '0' }).ok).toBe(true);
  });
});

describe('salvar as regras', () => {
  it('grava, registra só o que mudou na auditoria e vale para o que vier depois', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const r = await salvarRegras(espacoId, anf, regras({ cancelamentoIntegralHoras: 72, cancelamentoParcialPct: 30, fecha: 20 }), '203.0.113.7');
    expect(r.mudou.sort()).toEqual(['cancelamentoIntegralHoras', 'cancelamentoParcialPct', 'fecha']);

    const [linha] = await db.select().from(schema.regraEspaco).where(eq(schema.regraEspaco.espacoId, espacoId));
    expect(linha).toMatchObject({ cancelamentoIntegralHoras: 72, cancelamentoParcialPct: 30, fecha: '20:00:00', atualizadoPor: anf });
    expect(regrasParaTela(linha).fecha).toBe(20);

    const [ev] = await db
      .select()
      .from(schema.eventoAuditoria)
      .where(and(eq(schema.eventoAuditoria.entidadeId, espacoId), eq(schema.eventoAuditoria.acao, 'regras_alteradas')));
    expect(ev.usuarioId).toBe(anf);
    expect(ev.ip).toBe('203.0.113.7');
    expect(ev.dados).toEqual({
      antes: { cancelamentoIntegralHoras: 48, cancelamentoParcialPct: 50, fecha: 22 },
      depois: { cancelamentoIntegralHoras: 72, cancelamentoParcialPct: 30, fecha: 20 },
    });
  });

  it('não grava nem audita quando nada mudou', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const [linha] = await db.select().from(schema.regraEspaco).where(eq(schema.regraEspaco.espacoId, espacoId));
    expect((await salvarRegras(espacoId, anf, regrasParaTela(linha))).mudou).toEqual([]);
    const eventos = await db.select().from(schema.eventoAuditoria).where(eq(schema.eventoAuditoria.entidadeId, espacoId));
    expect(eventos).toHaveLength(0);
  });
});
