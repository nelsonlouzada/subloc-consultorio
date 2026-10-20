import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool, schema } from '@/db';

const enviarEmail = vi.fn<(para: string, assunto: string, html: string) => Promise<void>>();
vi.mock('@/lib/email', () => ({ enviarEmail: (...a: [string, string, string]) => enviarEmail(...a) }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

import { instanteLocal } from '@/lib/fuso';
import { garantirDocumentosIniciais } from '@/modulos/configuracao/documentos-iniciais';
import { fabrica } from '@/test/fabrica';
import { enviarCodigoAcesso } from './acesso';
import { cancelarReserva, ReservaJaIniciadaError } from './cancelamento';
import { marcarPago } from './pagamento';
import { criarReserva } from './reserva';
import { aprovarReserva, EstadoReservaError } from './solicitacao';

const f = fabrica();
const ctx = { ip: '203.0.113.5', userAgent: 'vitest' };
const agora = instanteLocal(2026, 10, 20, 12);
const h = (hora: number, dia = 2, mes = 11) => instanteLocal(2026, mes, dia, hora);

async function pedir(espacoId: string, profissionalId: string, de = 9, ate = 10, dia = 2) {
  const r = await criarReserva({ espacoId, profissionalId, inicio: h(de, dia), fim: h(ate, dia), unidade: 'hora' }, ctx, agora);
  if (!r.ok) throw new Error(`pedido recusado: ${r.erro}`);
  return r.reservaId;
}
const reserva = async (id: string) => (await db.select().from(schema.reserva).where(eq(schema.reserva.id, id)))[0];
const ocupacoes = (id: string) => db.select().from(schema.ocupacao).where(eq(schema.ocupacao.reservaId, id));
const cobrancaDe = async (prof: string) => (await db.select().from(schema.cobranca).where(eq(schema.cobranca.profissionalId, prof)))[0];
const emailsPara = (prof: string) => enviarEmail.mock.calls.filter((c) => c[0] === `${prof}@example.com`);

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

describe('cancelamento pelo Anfitrião', () => {
  it('reserva confirmada: libera o horário, apaga o código e avisa que há devolução a fazer', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const id = await pedir(espacoId, prof);
    await aprovarReserva(id, anf, {}, agora);
    await marcarPago(id, anf, {}, agora);
    await enviarCodigoAcesso(id, anf, '4321', {});
    expect((await reserva(id)).codigoAcesso).toBe('4321');

    const r = await cancelarReserva(id, anf, '  Obra na sala  ', { ip: '203.0.113.9' }, agora);
    expect(r).toEqual({ devolucaoPendente: true });
    expect(await reserva(id)).toMatchObject({ status: 'cancelada', codigoAcesso: null, canceladaPor: anf });
    expect((await ocupacoes(id)).length).toBe(0);
    expect((await cobrancaDe(prof)).status).toBe('paga'); // o dinheiro não some do registro

    const email = emailsPara(prof).find((e) => e[1].includes('cancelada'))!;
    expect(email[2]).toContain('Obra na sala');
    expect(email[2]).toContain('devolução');
    const [ev] = await db.select().from(schema.eventoAuditoria).where(eq(schema.eventoAuditoria.acao, 'reserva_cancelada'));
    expect(ev).toBeTruthy();

    // O horário voltou a ficar livre para outro pedido.
    const outra = await f.profissional();
    expect(await pedir(espacoId, outra)).toBeTruthy();
  });

  it('aprovada e ainda não paga: cancela a cobrança e não fala em devolução', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const id = await pedir(espacoId, prof, 11, 12);
    await aprovarReserva(id, anf, {}, agora);

    expect(await cancelarReserva(id, anf, null, {}, agora)).toEqual({ devolucaoPendente: false });
    expect((await cobrancaDe(prof)).status).toBe('cancelada');
    expect((await ocupacoes(id)).length).toBe(0);
    expect(emailsPara(prof).find((e) => e[1].includes('cancelada'))![2]).not.toContain('devolução');
  });

  it('só cancela reserva aprovada ou confirmada, uma vez, e antes de começar', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const solicitada = await pedir(espacoId, prof, 13, 14);
    await expect(cancelarReserva(solicitada, anf, null, {}, agora)).rejects.toThrow(EstadoReservaError);

    const id = await pedir(espacoId, prof, 15, 16);
    await aprovarReserva(id, anf, {}, agora);
    await marcarPago(id, anf, {}, agora);
    await expect(cancelarReserva(id, anf, null, {}, h(15))).rejects.toThrow(ReservaJaIniciadaError);
    expect((await reserva(id)).status).toBe('confirmada');

    await cancelarReserva(id, anf, null, {}, agora);
    await expect(cancelarReserva(id, anf, null, {}, agora)).rejects.toThrow(EstadoReservaError);
  });

  it('dois cancelamentos ao mesmo tempo: só um vale e só um e-mail sai', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const id = await pedir(espacoId, prof, 17, 18);
    await aprovarReserva(id, anf, {}, agora);
    await marcarPago(id, anf, {}, agora);

    const resultados = await Promise.allSettled([cancelarReserva(id, anf, null, {}, agora), cancelarReserva(id, anf, null, {}, agora)]);
    expect(resultados.filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect(emailsPara(prof).filter((e) => e[1].includes('cancelada')).length).toBe(1);
  });
});
