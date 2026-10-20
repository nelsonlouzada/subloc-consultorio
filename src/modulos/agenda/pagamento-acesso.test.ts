import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool, schema } from '@/db';

const enviarEmail = vi.fn<(para: string, assunto: string, html: string) => Promise<void>>();
vi.mock('@/lib/email', () => ({ enviarEmail: (...a: [string, string, string]) => enviarEmail(...a) }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

import { instanteLocal } from '@/lib/fuso';
import { garantirDocumentosIniciais } from '@/modulos/configuracao/documentos-iniciais';
import { fabrica } from '@/test/fabrica';
import { CodigoInvalidoError, enviarCodigoAcesso } from './acesso';
import { encerrarReservas } from './encerramento';
import { expirarPrazos } from './expiracao';
import { enviarLembretesDaVespera } from './lembretes';
import { saldoDisponivel } from '@/modulos/carteira/carteira';
import { marcarPago } from './pagamento';
import { listarPendenciasDaSala } from './pendencias';
import { criarReserva, type PedidoReserva } from './reserva';
import { aprovarReserva, EstadoReservaError } from './solicitacao';

const f = fabrica();
const ctx = { ip: '203.0.113.5', userAgent: 'vitest' };
const agora = instanteLocal(2026, 10, 20, 12);
const h = (hora: number, dia = 2, mes = 11) => instanteLocal(2026, mes, dia, hora);
const hora = (espacoId: string, profissionalId: string, de: number, ate: number, dia = 2): PedidoReserva => ({
  espacoId,
  profissionalId,
  inicio: h(de, dia),
  fim: h(ate, dia),
  unidade: 'hora',
});

async function pedir(espacoId: string, prof: string, de = 9, ate = 10, dia = 2, quando = agora) {
  const r = await criarReserva(hora(espacoId, prof, de, ate, dia), ctx, quando);
  if (!r.ok) throw new Error(`pedido recusado: ${r.erro}`);
  return r.reservaId;
}
const reserva = async (id: string) => (await db.select().from(schema.reserva).where(eq(schema.reserva.id, id)))[0];
const ocupacoes = (id: string) => db.select().from(schema.ocupacao).where(eq(schema.ocupacao.reservaId, id));
const cobrancaDe = async (prof: string) => (await db.select().from(schema.cobranca).where(eq(schema.cobranca.profissionalId, prof)))[0];
const emailsPara = (prof: string) => enviarEmail.mock.calls.filter((c) => c[0] === `${prof}@example.com`);

/** Pedido aprovado e aguardando pagamento. */
async function aprovado(espacoId: string, prof: string, anf: string, de = 9, ate = 10, dia = 2) {
  const id = await pedir(espacoId, prof, de, ate, dia);
  await aprovarReserva(id, anf, {}, agora);
  return id;
}
/** Reserva confirmada (pago por Pix manual). */
async function confirmada(espacoId: string, prof: string, anf: string, de = 9, ate = 10, dia = 2) {
  const id = await aprovado(espacoId, prof, anf, de, ate, dia);
  await marcarPago(id, anf, {}, agora);
  return id;
}

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

describe('marcar pago (Pix manual)', () => {
  it('confirma a reserva e registra a cobrança como paga, por quem e quando', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const id = await aprovado(espacoId, prof, anf);

    expect(await marcarPago(id, anf, { ip: '203.0.113.9' }, agora)).toEqual({ reativada: false, creditoCentavos: 0 });
    expect(await reserva(id)).toMatchObject({ status: 'confirmada' });
    expect((await ocupacoes(id)).length).toBe(1);
    const c = await cobrancaDe(prof);
    expect(c).toMatchObject({ status: 'paga', meio: 'pix_manual', marcadaPagaPor: anf });
    expect(c.pagoEm?.getTime()).toBe(agora.getTime());

    const email = emailsPara(prof).find((e) => e[1].includes('Pagamento recebido'))!;
    expect(email[2]).toContain('R$ 50,00');
    const [ev] = await db.select().from(schema.eventoAuditoria).where(eq(schema.eventoAuditoria.entidadeId, id));
    expect(ev).toBeTruthy();
  });

  it('marcar duas vezes, ou antes da aprovação, é erro claro', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const naoAprovado = await pedir(espacoId, prof, 9, 10, 2);
    await expect(marcarPago(naoAprovado, anf, {}, agora)).rejects.toThrow(EstadoReservaError);

    const id = await aprovado(espacoId, prof, anf, 9, 10, 3);
    await marcarPago(id, anf, {}, agora);
    await expect(marcarPago(id, anf, {}, agora)).rejects.toThrow(EstadoReservaError);
  });

  it('pagamento depois da expiração: se o horário está livre, a reserva volta confirmada', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const id = await aprovado(espacoId, prof, anf);
    await expirarPrazos(new Date(agora.getTime() + 3 * 3_600_000)); // venceu o prazo de pagamento
    expect((await reserva(id)).status).toBe('expirada');
    expect(await ocupacoes(id)).toHaveLength(0);

    expect(await marcarPago(id, anf, {}, new Date(agora.getTime() + 4 * 3_600_000))).toEqual({ reativada: true, creditoCentavos: 0 });
    expect((await reserva(id)).status).toBe('confirmada');
    expect(await ocupacoes(id)).toHaveLength(1);
    expect((await cobrancaDe(prof)).status).toBe('paga');
  });

  it('pagamento depois da expiração com o horário já ocupado: recusa e não confirma nada', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const a = await f.profissional();
    const b = await f.profissional();
    const id = await aprovado(espacoId, a, anf);
    await expirarPrazos(new Date(agora.getTime() + 3 * 3_600_000));
    await pedir(espacoId, b); // outra pessoa pegou o horário livre

    const quando = new Date(agora.getTime() + 4 * 3_600_000);
    expect(await marcarPago(id, anf, {}, quando)).toEqual({ reativada: false, creditoCentavos: 5000 });
    // O horário segue com a outra pessoa; o dinheiro de quem pagou atrasado virou crédito.
    expect((await reserva(id)).status).toBe('expirada');
    expect((await ocupacoes(id)).length).toBe(0);
    expect((await cobrancaDe(a)).status).toBe('paga');
    expect(await saldoDisponivel(a, quando)).toBe(5000);
    const [lote] = await db.select().from(schema.creditoLote).where(eq(schema.creditoLote.profissionalId, a));
    expect(lote).toMatchObject({ origem: 'pagamento_atrasado', valorInicialCentavos: 5000, reservaId: id });
    expect(emailsPara(a).some((e) => e[1].includes('virou crédito'))).toBe(true);
    expect(emailsPara(a).some((e) => e[1].includes('Pagamento recebido'))).toBe(false);
    // Marcar de novo não duplica o crédito.
    await expect(marcarPago(id, anf, {}, quando)).rejects.toThrow(EstadoReservaError);
    expect(await saldoDisponivel(a, quando)).toBe(5000);
  });

  it('pedido que expirou sem nunca ter sido aprovado não aceita pagamento', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const id = await pedir(espacoId, prof);
    await expirarPrazos(new Date(agora.getTime() + 13 * 3_600_000));
    await expect(marcarPago(id, anf, {}, agora)).rejects.toThrow(EstadoReservaError);
  });

  it('pagamento de reserva cujo horário já começou não reativa', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const id = await aprovado(espacoId, prof, anf);
    await expirarPrazos(new Date(agora.getTime() + 3 * 3_600_000));
    const jaComecou = new Date(h(9).getTime() + 60_000); // um minuto depois do início da reserva
    expect(await marcarPago(id, anf, {}, jaComecou)).toEqual({ reativada: false, creditoCentavos: 5000 });
    expect((await reserva(id)).status).toBe('expirada');
    expect(await saldoDisponivel(prof, jaComecou)).toBe(5000);
  });

  it('pagamento e expiração no mesmo instante: o resultado é sempre coerente', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const id = await aprovado(espacoId, prof, anf);
    const depois = new Date(agora.getTime() + 3 * 3_600_000);
    await Promise.allSettled([marcarPago(id, anf, {}, depois), expirarPrazos(depois)]);

    const r = await reserva(id);
    const c = await cobrancaDe(prof);
    const oc = await ocupacoes(id);
    if (r.status === 'confirmada') {
      expect(c.status).toBe('paga');
      expect(oc).toHaveLength(1);
    } else {
      expect(r.status).toBe('expirada');
      expect(c.status).toBe('expirada');
      expect(oc).toHaveLength(0);
    }
  });
});

describe('código de acesso', () => {
  it('guarda o código na reserva, manda por e-mail e não o põe na auditoria', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const id = await confirmada(espacoId, prof, anf);

    expect(await enviarCodigoAcesso(id, anf, ' 4821# ', {}, agora)).toBe('enviado');
    expect(await reserva(id)).toMatchObject({ codigoAcesso: '4821#', codigoAcessoEnviadoPor: anf });
    const email = emailsPara(prof).find((e) => e[1].includes('Código de acesso'))!;
    expect(email[2]).toContain('4821#');
    const eventos = await db.select().from(schema.eventoAuditoria).where(eq(schema.eventoAuditoria.entidadeId, id));
    expect(JSON.stringify(eventos)).not.toContain('4821');
  });

  it('só reserva confirmada recebe código', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const id = await aprovado(espacoId, prof, anf);
    await expect(enviarCodigoAcesso(id, anf, '1234', {}, agora)).rejects.toThrow(EstadoReservaError);
  });

  it.each(['', '12', 'abc def', '<script>', 'x'.repeat(21)])('recusa código inválido: %j', async (codigo) => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const id = await confirmada(espacoId, await f.profissional(), anf);
    await expect(enviarCodigoAcesso(id, anf, codigo, {}, agora)).rejects.toThrow(CodigoInvalidoError);
    expect((await reserva(id)).codigoAcesso).toBeNull();
  });

  it('pode reenviar com outro código, e os dois envios saem', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const id = await confirmada(espacoId, prof, anf);
    await enviarCodigoAcesso(id, anf, '1111', {}, agora);
    await enviarCodigoAcesso(id, anf, '2222', {}, new Date(agora.getTime() + 60_000));
    expect((await reserva(id)).codigoAcesso).toBe('2222');
    expect(emailsPara(prof).filter((e) => e[1].includes('Código de acesso'))).toHaveLength(2);
  });
});

describe('encerramento das reservas', () => {
  it('reserva terminada vira realizada e o código é apagado; as futuras não mudam', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const passada = await confirmada(espacoId, prof, anf, 9, 10, 2);
    const futura = await confirmada(espacoId, prof, anf, 9, 10, 3);
    await enviarCodigoAcesso(passada, anf, '1111', {}, agora);
    await enviarCodigoAcesso(futura, anf, '2222', {}, agora);

    const depoisDaPrimeira = h(11, 2); // 02/11 às 11h: a primeira terminou às 10h, a segunda é no dia 3
    await encerrarReservas(depoisDaPrimeira);
    expect(await reserva(passada)).toMatchObject({ status: 'realizada', codigoAcesso: null });
    expect(await reserva(futura)).toMatchObject({ status: 'confirmada', codigoAcesso: '2222' });
  });

  it('apaga o código de reserva que deixou de estar confirmada', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const id = await confirmada(espacoId, await f.profissional(), anf);
    await enviarCodigoAcesso(id, anf, '3333', {}, agora);
    await db.update(schema.reserva).set({ status: 'cancelada' }).where(eq(schema.reserva.id, id));
    await encerrarReservas(agora);
    expect((await reserva(id)).codigoAcesso).toBeNull();
  });
});

describe('lembrete da véspera', () => {
  const hoje19h = instanteLocal(2026, 10, 20, 19); // terça 20/10 às 19h: amanhã é 21/10

  async function paraAmanha(espacoId: string, prof: string, anf: string, dia = 21) {
    const quando = instanteLocal(2026, 10, 19, 9);
    const r = await criarReserva({ ...hora(espacoId, prof, 10, 11, dia), inicio: h(10, dia, 10), fim: h(11, dia, 10) }, ctx, quando);
    if (!r.ok) throw new Error(`pedido recusado: ${r.erro}`);
    await aprovarReserva(r.reservaId, anf, {}, quando);
    await marcarPago(r.reservaId, anf, {}, quando);
    return r.reservaId;
  }

  it('avisa quem tem reserva confirmada amanhã, uma única vez, com o código se já existir', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const id = await paraAmanha(espacoId, prof, anf);
    await enviarCodigoAcesso(id, anf, '7654', {}, instanteLocal(2026, 10, 19, 10));
    enviarEmail.mockClear();

    expect((await enviarLembretesDaVespera(hoje19h)).enviados).toBeGreaterThanOrEqual(1);
    const lembretes = emailsPara(prof).filter((e) => e[1].includes('Lembrete'));
    expect(lembretes).toHaveLength(1);
    expect(lembretes[0][2]).toContain('7654');

    await enviarLembretesDaVespera(hoje19h);
    await enviarLembretesDaVespera(new Date(hoje19h.getTime() + 3_600_000));
    expect(emailsPara(prof).filter((e) => e[1].includes('Lembrete'))).toHaveLength(1);
  });

  it('antes da hora do lembrete (18h) não envia', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    await paraAmanha(espacoId, prof, anf);
    enviarEmail.mockClear();
    await enviarLembretesDaVespera(instanteLocal(2026, 10, 20, 17));
    expect(emailsPara(prof).some((e) => e[1].includes('Lembrete'))).toBe(false);
  });

  it('só reservas confirmadas e só as de amanhã', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    await paraAmanha(espacoId, prof, anf, 22); // depois de amanhã
    const quando = instanteLocal(2026, 10, 19, 9);
    const naoConfirmada = await criarReserva({ ...hora(espacoId, prof, 13, 14, 21), inicio: h(13, 21, 10), fim: h(14, 21, 10) }, ctx, quando);
    expect(naoConfirmada.ok).toBe(true); // solicitada, sem pagamento
    enviarEmail.mockClear();
    await enviarLembretesDaVespera(hoje19h);
    expect(emailsPara(prof).some((e) => e[1].includes('Lembrete'))).toBe(false);
  });
});

describe('pendências do Anfitrião', () => {
  it('lista códigos a enviar e pagamentos prestes a expirar', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const semCodigo = await confirmada(espacoId, prof, anf, 9, 10, 2);
    const comCodigo = await confirmada(espacoId, prof, anf, 9, 10, 3);
    await enviarCodigoAcesso(comCodigo, anf, '9999', {}, agora);
    const aguardando = await aprovado(espacoId, prof, anf, 9, 10, 4); // paga até agora + 2h

    const longe = await listarPendenciasDaSala(espacoId, agora); // faltam 2h: fora da janela de 1h
    expect(longe.codigosAEnviar.map((x) => x.id)).toEqual([semCodigo]);
    expect(longe.pagamentosExpirando).toHaveLength(0);

    const perto = await listarPendenciasDaSala(espacoId, new Date(agora.getTime() + 90 * 60_000)); // falta meia hora
    expect(perto.pagamentosExpirando.map((x) => x.id)).toEqual([aguardando]);
  });
});
