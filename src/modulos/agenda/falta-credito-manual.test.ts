import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool, schema } from '@/db';

const enviarEmail = vi.fn<(para: string, assunto: string, html: string) => Promise<void>>();
vi.mock('@/lib/email', () => ({ enviarEmail: (...a: [string, string, string]) => enviarEmail(...a) }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

import { reaisParaCentavos } from '@/lib/dinheiro';
import { instanteLocal } from '@/lib/fuso';
import { saldoDisponivel, usarCredito } from '@/modulos/carteira/carteira';
import { CreditoManualInvalidoError, concederCreditoManual, ProfissionalSemCadastroError } from '@/modulos/carteira/manual';
import { garantirDocumentosIniciais } from '@/modulos/configuracao/documentos-iniciais';
import { fabrica } from '@/test/fabrica';
import { encerrarReservas } from './encerramento';
import { desfazerFalta, registrarFalta, ReservaNaoIniciadaError } from './falta';
import { marcarPago } from './pagamento';
import { criarReserva } from './reserva';
import { aprovarReserva, EstadoReservaError } from './solicitacao';

const f = fabrica();
const ctx = { ip: '203.0.113.5', userAgent: 'vitest' };
const agora = instanteLocal(2026, 10, 20, 12);
const h = (hora: number, dia = 2, mes = 11) => instanteLocal(2026, mes, dia, hora);

async function confirmada(espacoId: string, prof: string, anf: string, de = 9, ate = 10, dia = 2) {
  const r = await criarReserva({ espacoId, profissionalId: prof, inicio: h(de, dia), fim: h(ate, dia), unidade: 'hora' }, ctx, agora);
  if (!r.ok) throw new Error(`pedido recusado: ${r.erro}`);
  await aprovarReserva(r.reservaId, anf, {}, agora);
  await marcarPago(r.reservaId, anf, {}, agora);
  return r.reservaId;
}
const reserva = async (id: string) => (await db.select().from(schema.reserva).where(eq(schema.reserva.id, id)))[0];
const emails = (para: string) => enviarEmail.mock.calls.filter((c) => c[0] === `${para}@example.com`);

beforeAll(async () => {
  await garantirDocumentosIniciais();
});
beforeEach(() => {
  enviarEmail.mockReset();
  enviarEmail.mockResolvedValue(undefined);
});
afterAll(async () => {
  await f.limpar();
  await pool.end();
});

describe('registro de falta', () => {
  it('registra a falta de reserva confirmada que já começou: apaga o código, avisa e não gera crédito', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const id = await confirmada(espacoId, prof, anf);
    await db.update(schema.reserva).set({ codigoAcesso: '9876' }).where(eq(schema.reserva.id, id));

    await registrarFalta(id, anf, { ip: '203.0.113.9' }, new Date(h(9).getTime() + 30 * 60_000));
    expect(await reserva(id)).toMatchObject({ status: 'falta', codigoAcesso: null });
    expect(await saldoDisponivel(prof, agora)).toBe(0);
    expect(emails(prof).some((e) => e[1].includes('Falta registrada'))).toBe(true);
    const [ev] = await db.select().from(schema.eventoAuditoria).where(eq(schema.eventoAuditoria.acao, 'falta_registrada'));
    expect(ev).toBeTruthy();
  });

  it('também vale depois que o job marcou a reserva como realizada, e dá para desfazer', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const id = await confirmada(espacoId, prof, anf);
    const depois = h(12);
    await encerrarReservas(depois);
    expect((await reserva(id)).status).toBe('realizada');

    await registrarFalta(id, anf, {}, depois);
    expect((await reserva(id)).status).toBe('falta');
    await desfazerFalta(id, anf, {}, depois);
    expect((await reserva(id)).status).toBe('realizada');
    await expect(desfazerFalta(id, anf, {}, depois)).rejects.toThrow(EstadoReservaError);
  });

  it('não registra falta antes do início, nem de reserva não confirmada, nem duas vezes', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const id = await confirmada(espacoId, prof, anf);
    await expect(registrarFalta(id, anf, {}, agora)).rejects.toThrow(ReservaNaoIniciadaError);

    const pedido = await criarReserva({ espacoId, profissionalId: prof, inicio: h(13), fim: h(14), unidade: 'hora' }, ctx, agora);
    if (!pedido.ok) throw new Error('pedido recusado');
    await expect(registrarFalta(pedido.reservaId, anf, {}, h(14))).rejects.toThrow(EstadoReservaError);

    await registrarFalta(id, anf, {}, h(10));
    await expect(registrarFalta(id, anf, {}, h(10))).rejects.toThrow(EstadoReservaError);
  });
});

describe('crédito manual do Anfitrião', () => {
  it('cria o lote, registra quem e por quê, e avisa a pessoa', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const lote = await concederCreditoManual({ anfitriaoId: anf, profissionalId: prof, espacoId, valorCentavos: 12000, motivo: '  Obra na sala em 28/10  ' }, { ip: '203.0.113.9' }, agora);

    expect(lote).toMatchObject({ origem: 'ajuste_manual', valorInicialCentavos: 12000, criadoPor: anf });
    expect(await saldoDisponivel(prof, agora)).toBe(12000);
    const [ev] = await db.select().from(schema.eventoAuditoria).where(eq(schema.eventoAuditoria.entidadeId, prof));
    expect(ev).toMatchObject({ acao: 'credito_manual', usuarioId: anf });
    expect(JSON.stringify(ev.dados)).toContain('Obra na sala em 28/10');
    const email = emails(prof).find((e) => e[1].includes('crédito'))!;
    expect(email[2]).toContain('R$ 120,00');
    expect(email[2]).toContain('Obra na sala');
    // E o crédito é de fato usável.
    expect(await db.transaction((tx) => usarCredito(tx, { profissionalId: prof, ate: 5000 }, agora))).toBe(5000);
  });

  it('recusa valor inválido, motivo vazio e profissional inexistente, sem gravar nada', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const base = { anfitriaoId: anf, profissionalId: prof, espacoId, valorCentavos: 1000, motivo: 'Cortesia' };
    for (const valorCentavos of [0, -5, 10.5, 1_000_001]) {
      await expect(concederCreditoManual({ ...base, valorCentavos })).rejects.toThrow(CreditoManualInvalidoError);
    }
    await expect(concederCreditoManual({ ...base, motivo: '  ' })).rejects.toThrow(CreditoManualInvalidoError);
    await expect(concederCreditoManual({ ...base, profissionalId: 'nao-existe' })).rejects.toThrow(ProfissionalSemCadastroError);
    expect(await saldoDisponivel(prof, agora)).toBe(0);
    expect(emails(prof)).toHaveLength(0);
  });
});

describe('reaisParaCentavos', () => {
  it('entende os jeitos comuns de digitar', () => {
    expect(reaisParaCentavos('50')).toBe(5000);
    expect(reaisParaCentavos('50,5')).toBe(5050);
    expect(reaisParaCentavos('50,05')).toBe(5005);
    expect(reaisParaCentavos('1.234,56')).toBe(123456);
    expect(reaisParaCentavos('R$ 80')).toBe(8000);
    expect(reaisParaCentavos('50.25')).toBe(5025);
  });

  it('recusa o que não é dinheiro, em vez de adivinhar', () => {
    for (const t of ['', 'abc', '-5', '5,123', '1,2,3', '50 reais', '1e3', '0x10']) expect(reaisParaCentavos(t)).toBeNull();
  });
});
