import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool, schema } from '@/db';

const enviarEmail = vi.fn<(para: string, assunto: string, html: string) => Promise<void>>();
vi.mock('@/lib/email', () => ({ enviarEmail: (...a: [string, string, string]) => enviarEmail(...a) }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import { POST as webhook } from '@/app/api/webhooks/asaas/route';
import { instanteLocal } from '@/lib/fuso';
import { cancelarReserva } from '@/modulos/agenda/cancelamento';
import { expirarPrazos } from '@/modulos/agenda/expiracao';
import { criarReserva } from '@/modulos/agenda/reserva';
import { aprovarReserva } from '@/modulos/agenda/solicitacao';
import { carteiraDoProfissional, saldoDisponivel } from '@/modulos/carteira/carteira';
import { garantirDocumentosIniciais } from '@/modulos/configuracao/documentos-iniciais';
import { fabrica } from '@/test/fabrica';
import { comprarPacote } from './pacotes';
import { carregarRecibo, emitirRecibo, gerarPdfRecibo } from './recibo';
import { aplicarEventoAsaas } from './webhook';

const f = fabrica();
const ctx = { ip: '203.0.113.5', userAgent: 'vitest' };
const agora = instanteLocal(2026, 10, 20, 12);
const h = (hora: number, dia = 2, mes = 11) => instanteLocal(2026, mes, dia, hora);

// ---- Asaas simulado: registra as chamadas e responde como a API v3
type Chamada = { metodo: string; caminho: string; corpo: Record<string, unknown> | null };
let chamadas: Chamada[] = [];
let asaasFalha = false;
let contador = 0;
const fetchFalso = vi.fn(async (url: string | URL, init?: RequestInit) => {
  const caminho = String(url).replace(/^https?:\/\/[^/]+\/v3/, '');
  const metodo = init?.method ?? 'GET';
  chamadas.push({ metodo, caminho, corpo: init?.body ? JSON.parse(String(init.body)) : null });
  const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });
  if (asaasFalha) return resposta({ errors: [{ description: 'indisponível' }] }, 500);
  if (metodo === 'POST' && caminho === '/customers') return resposta({ id: `cus_${++contador}` });
  if (metodo === 'POST' && caminho === '/payments') return resposta({ id: `pay_${++contador}`, invoiceUrl: 'https://sandbox.asaas.com/i/abc' });
  if (metodo === 'GET' && caminho.endsWith('/pixQrCode')) return resposta({ payload: '00020126PIXCOPIAECOLA', encodedImage: 'iVBORw0KGgo=' });
  if (metodo === 'DELETE') return resposta({ deleted: true });
  return resposta({}, 404);
});

const ambienteAnterior = { ...process.env };
beforeAll(async () => {
  vi.stubGlobal('fetch', fetchFalso);
  process.env.ASAAS_ATIVO = 'true';
  process.env.ASAAS_API_KEY = 'chave-de-teste';
  process.env.ASAAS_BASE_URL = 'https://api-sandbox.asaas.com/v3';
  process.env.ASAAS_WEBHOOK_TOKEN = 'token-de-teste';
  await garantirDocumentosIniciais();
});
beforeEach(() => {
  enviarEmail.mockReset();
  enviarEmail.mockResolvedValue(undefined);
  chamadas = [];
  asaasFalha = false;
  process.env.ASAAS_ATIVO = 'true';
});
afterAll(async () => {
  vi.unstubAllGlobals();
  process.env = ambienteAnterior;
  await f.limpar();
  await pool.end();
});

async function pedir(espacoId: string, profissionalId: string, de = 9, ate = 10, dia = 2) {
  const r = await criarReserva({ espacoId, profissionalId, inicio: h(de, dia), fim: h(ate, dia), unidade: 'hora' }, ctx, agora);
  if (!r.ok) throw new Error(`pedido recusado: ${r.erro}`);
  return r.reservaId;
}
const reserva = async (id: string) => (await db.select().from(schema.reserva).where(eq(schema.reserva.id, id)))[0];
const cobrancaDe = async (prof: string) => (await db.select().from(schema.cobranca).where(eq(schema.cobranca.profissionalId, prof)))[0];
const emails = (para: string) => enviarEmail.mock.calls.filter((c) => c[0] === `${para}@example.com`);
const evento = (c: { id: string; asaasCobrancaId: string | null; valorCobradoCentavos: number }, extra: Record<string, unknown> = {}, event = 'PAYMENT_RECEIVED') => ({
  id: `evt_${Math.random().toString(36).slice(2)}`,
  event,
  payment: { id: c.asaasCobrancaId ?? undefined, value: c.valorCobradoCentavos / 100, billingType: 'PIX', status: 'RECEIVED', externalReference: c.id, ...extra },
});
const enviarWebhook = (corpo: unknown, token = 'token-de-teste') =>
  webhook(new Request('http://localhost/api/webhooks/asaas', { method: 'POST', headers: { 'asaas-access-token': token, 'content-type': 'application/json' }, body: JSON.stringify(corpo) }));

describe('cobrança online ao aprovar', () => {
  it('cria cliente e Pix no Asaas, guarda QR e copia-e-cola e manda no e-mail; o cliente é reaproveitado', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const id = await pedir(espacoId, prof, 9, 10, 2);
    await aprovarReserva(id, anf, {}, agora);

    expect(chamadas.map((c) => `${c.metodo} ${c.caminho}`)).toEqual(['POST /customers', 'POST /payments', expect.stringMatching(/^GET \/payments\/pay_\d+\/pixQrCode$/)]);
    const pagamento = chamadas[1].corpo!;
    expect(pagamento).toMatchObject({ billingType: 'PIX', value: 50 });
    const c = await cobrancaDe(prof);
    expect(pagamento.externalReference).toBe(c.id);
    expect(c).toMatchObject({ pixCopiaCola: '00020126PIXCOPIAECOLA', pixQrImagem: 'iVBORw0KGgo=', asaasLinkFatura: 'https://sandbox.asaas.com/i/abc' });
    expect(c.asaasCobrancaId).toMatch(/^pay_/);
    const email = emails(prof).find((e) => e[1].includes('aprovada'))!;
    expect(email[2]).toContain('00020126PIXCOPIAECOLA');
    expect(email[2]).toContain('automaticamente');

    // Segundo pedido da mesma pessoa: não cria cliente de novo.
    chamadas = [];
    const id2 = await pedir(espacoId, prof, 11, 12, 2);
    await aprovarReserva(id2, anf, {}, agora);
    expect(chamadas.some((x) => x.caminho === '/customers')).toBe(false);
    expect(chamadas.find((x) => x.caminho === '/payments')!.corpo!.customer).toBe(chamadas.length ? (await db.select().from(schema.profissional).where(eq(schema.profissional.usuarioId, prof)))[0].asaasClienteId : '');
  });

  it('se o Asaas falha, aprovar funciona e o e-mail leva o Pix manual', async () => {
    process.env.PIX_MANUAL_CHAVE = 'chave-manual@teste';
    process.env.PIX_MANUAL_NOME = 'Fulana';
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const id = await pedir(espacoId, prof);
    asaasFalha = true;
    await aprovarReserva(id, anf, {}, agora);

    expect((await reserva(id)).status).toBe('aguardando_pagamento');
    expect((await cobrancaDe(prof)).asaasCobrancaId).toBeNull();
    expect(emails(prof).find((e) => e[1].includes('aprovada'))![2]).toContain('chave-manual@teste');
  });

  it('com o pagamento online desligado, o Asaas nem é chamado', async () => {
    process.env.ASAAS_ATIVO = 'false';
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    await aprovarReserva(await pedir(espacoId, prof), anf, {}, agora);
    expect(chamadas).toHaveLength(0);
  });

  it('crédito que cobre tudo não gera cobrança no Asaas', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const { concederCredito } = await import('@/modulos/carteira/carteira');
    await concederCredito(db, { profissionalId: prof, espacoId, origem: 'ajuste_manual', valorCentavos: 9000 }, agora);
    await aprovarReserva(await pedir(espacoId, prof), anf, {}, agora);
    expect(chamadas).toHaveLength(0);
  });

  it('cancelar reserva não paga cancela a cobrança no Asaas', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const id = await pedir(espacoId, prof);
    await aprovarReserva(id, anf, {}, agora);
    const c = await cobrancaDe(prof);
    chamadas = [];
    await cancelarReserva(id, anf, null, {}, agora);
    expect(chamadas).toEqual([{ metodo: 'DELETE', caminho: `/payments/${c.asaasCobrancaId}`, corpo: null }]);
  });
});

describe('aviso de pagamento do Asaas (webhook)', () => {
  async function aprovada(prof?: string) {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const p = prof ?? (await f.profissional());
    const id = await pedir(espacoId, p);
    await aprovarReserva(id, anf, {}, agora);
    return { espacoId, anf, prof: p, id, c: await cobrancaDe(p) };
  }

  it('confirma a reserva sozinho, emite o recibo e avisa; o mesmo aviso de novo não faz nada', async () => {
    const { prof, id, c } = await aprovada();
    const corpo = evento(c);
    const r1 = await enviarWebhook(corpo);
    expect(r1.status).toBe(200);

    expect((await reserva(id)).status).toBe('confirmada');
    expect(await cobrancaDe(prof)).toMatchObject({ status: 'paga', meio: 'pix', marcadaPagaPor: null });
    const [rec] = await db.select().from(schema.recibo).where(eq(schema.recibo.cobrancaId, c.id));
    expect(rec.numero).toBeGreaterThan(0);
    expect(emails(prof).filter((e) => e[1].includes('Pagamento recebido')).length).toBe(1);
    const [ev] = await db.select().from(schema.webhookEvento).where(eq(schema.webhookEvento.eventoId, corpo.id));
    expect(ev.processadoEm).not.toBeNull();
    expect(ev.erro).toBeNull();

    const r2 = await enviarWebhook(corpo);
    expect(await r2.json()).toMatchObject({ duplicado: true });
    expect(emails(prof).filter((e) => e[1].includes('Pagamento recebido')).length).toBe(1);
    expect((await db.select().from(schema.recibo).where(eq(schema.recibo.cobrancaId, c.id))).length).toBe(1);
  });

  it('um aviso novo para a mesma cobrança já paga é ignorado (cartão confirma e depois recebe)', async () => {
    const { prof, c } = await aprovada();
    await enviarWebhook(evento(c, { billingType: 'CREDIT_CARD', status: 'CONFIRMED' }, 'PAYMENT_CONFIRMED'));
    expect((await cobrancaDe(prof)).meio).toBe('cartao');
    const r = await aplicarEventoAsaas(evento(c));
    expect(r).toMatchObject({ situacao: 'ignorado' });
    expect(emails(prof).filter((e) => e[1].includes('Pagamento recebido')).length).toBe(1);
  });

  it('token errado é 401 e nada é gravado', async () => {
    const { c, id } = await aprovada();
    const corpo = evento(c);
    expect((await enviarWebhook(corpo, 'token-errado')).status).toBe(401);
    expect((await reserva(id)).status).toBe('aguardando_pagamento');
    expect((await db.select().from(schema.webhookEvento).where(eq(schema.webhookEvento.eventoId, corpo.id))).length).toBe(0);
  });

  it('valor diferente do cobrado não confirma nada e fica registrado como problema (resposta 200)', async () => {
    const { c, id } = await aprovada();
    const corpo = evento(c, { value: 1 });
    expect((await enviarWebhook(corpo)).status).toBe(200);
    expect((await reserva(id)).status).toBe('aguardando_pagamento');
    const [ev] = await db.select().from(schema.webhookEvento).where(eq(schema.webhookEvento.eventoId, corpo.id));
    expect(ev.erro).toContain('diferente');
  });

  it('cobrança desconhecida e referência trocada viram problema, sem confirmar', async () => {
    const { c, id } = await aprovada();
    expect((await aplicarEventoAsaas(evento({ ...c, asaasCobrancaId: 'pay_inexistente' }))).situacao).toBe('problema');
    expect((await aplicarEventoAsaas(evento(c, { externalReference: 'outra' }))).situacao).toBe('problema');
    expect((await reserva(id)).status).toBe('aguardando_pagamento');
  });

  it('eventos que não são de pagamento são ignorados', async () => {
    const { c } = await aprovada();
    expect((await aplicarEventoAsaas(evento(c, {}, 'PAYMENT_OVERDUE'))).situacao).toBe('ignorado');
  });

  it('falha inesperada devolve 500 e o aviso é reaplicado quando o Asaas reenviar', async () => {
    const { c, id } = await aprovada();
    const corpo = evento(c);
    const espiao = vi.spyOn(db, 'transaction').mockRejectedValueOnce(new Error('banco indisponível'));
    const r1 = await enviarWebhook(corpo);
    espiao.mockRestore();

    expect(r1.status).toBe(500);
    const [falhou] = await db.select().from(schema.webhookEvento).where(eq(schema.webhookEvento.eventoId, corpo.id));
    expect(falhou.processadoEm).toBeNull();
    expect(falhou.erro).toContain('banco indisponível');
    expect((await reserva(id)).status).toBe('aguardando_pagamento');

    const r2 = await enviarWebhook(corpo); // o Asaas tenta de novo
    expect(r2.status).toBe(200);
    expect((await reserva(id)).status).toBe('confirmada');
    const [ok] = await db.select().from(schema.webhookEvento).where(eq(schema.webhookEvento.eventoId, corpo.id));
    expect(ok.processadoEm).not.toBeNull();
    expect(ok.erro).toBeNull();
  });

  it('pagamento depois da expiração: reativa se o horário está livre', async () => {
    const { c, id, prof } = await aprovada();
    const depois = new Date(agora.getTime() + 4 * 3_600_000);
    await expirarPrazos(depois);
    expect((await reserva(id)).status).toBe('expirada');
    await aplicarEventoAsaas(evento(c), depois);
    expect((await reserva(id)).status).toBe('confirmada');
    expect((await cobrancaDe(prof)).status).toBe('paga');
  });

  it('pagamento de uma reserva já cancelada vira crédito integral', async () => {
    const { c, id, prof, anf } = await aprovada();
    // Simula o cancelamento sem conseguir cancelar no Asaas (a cobrança segue aberta lá).
    asaasFalha = true;
    await cancelarReserva(id, anf, null, {}, agora);
    asaasFalha = false;
    expect((await reserva(id)).status).toBe('cancelada');

    const r = await aplicarEventoAsaas(evento(c), agora);
    expect(r).toMatchObject({ situacao: 'processado', detalhe: 'virou crédito' });
    expect(await saldoDisponivel(prof, agora)).toBe(5000);
    expect((await cobrancaDe(prof)).status).toBe('paga');
    expect(emails(prof).some((e) => e[1].includes('virou crédito'))).toBe(true);
    // E de novo: sem duplicar.
    await aplicarEventoAsaas(evento(c), agora);
    expect(await saldoDisponivel(prof, agora)).toBe(5000);
  });
});

describe('banco de horas (pacotes de crédito)', () => {
  async function comPacote(valorPago = 45000, valorCredito = 50000) {
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    const [pacote] = await db.insert(schema.pacoteCredito).values({ espacoId, nome: 'Pacote 10 horas', valorPagoCentavos: valorPago, valorCreditoCentavos: valorCredito }).returning();
    return { espacoId, prof, pacote };
  }

  it('comprar cria a cobrança e o Pix; o crédito (com bônus) só entra quando o pagamento é reconhecido', async () => {
    const { prof, pacote } = await comPacote();
    const r = await comprarPacote(prof, pacote.id, agora);
    expect(r.ok).toBe(true);
    const c = await cobrancaDe(prof);
    expect(c).toMatchObject({ finalidade: 'compra_credito', valorCobradoCentavos: 45000, status: 'pendente' });
    expect(c.pixCopiaCola).toBeTruthy();
    expect(chamadas.find((x) => x.caminho === '/payments')!.corpo).toMatchObject({ value: 450 });
    expect(await saldoDisponivel(prof, agora)).toBe(0);

    await aplicarEventoAsaas(evento(c), agora);
    expect(await saldoDisponivel(prof, agora)).toBe(50000); // pagou 450, recebeu 500
    const carteira = await carteiraDoProfissional(prof, agora);
    expect(carteira.lotes[0]).toMatchObject({ origem: 'compra', valorInicialCentavos: 50000, cobrancaId: c.id });
    expect(emails(prof).some((e) => e[1].includes('Crédito comprado'))).toBe(true);
    const recibo = await emitirRecibo(c.id);
    expect(recibo).not.toBeNull();

    // Aviso repetido não credita de novo.
    await aplicarEventoAsaas(evento(c), agora);
    expect(await saldoDisponivel(prof, agora)).toBe(50000);
  });

  it('recusa pacote inexistente/inativo, cadastro não aprovado, e pagamento online desligado ou fora do ar (sem deixar lixo)', async () => {
    const { prof, pacote, espacoId } = await comPacote();
    expect(await comprarPacote(prof, '00000000-0000-0000-0000-000000000000')).toEqual({ ok: false, erro: 'pacote_invalido' });
    const pendente = await f.profissional('pendente');
    expect(await comprarPacote(pendente, pacote.id)).toEqual({ ok: false, erro: 'profissional_nao_pode' });

    process.env.ASAAS_ATIVO = 'false';
    expect(await comprarPacote(prof, pacote.id)).toEqual({ ok: false, erro: 'pagamento_indisponivel' });
    process.env.ASAAS_ATIVO = 'true';
    asaasFalha = true;
    expect(await comprarPacote(prof, pacote.id)).toEqual({ ok: false, erro: 'pagamento_indisponivel' });
    expect(await db.select().from(schema.cobranca).where(eq(schema.cobranca.profissionalId, prof))).toHaveLength(0);

    await db.update(schema.pacoteCredito).set({ ativo: false }).where(eq(schema.pacoteCredito.id, pacote.id));
    asaasFalha = false;
    expect(await comprarPacote(prof, pacote.id)).toEqual({ ok: false, erro: 'pacote_invalido' });
    void espacoId;
  });

  it('o banco recusa pacote que dá menos crédito do que custa', async () => {
    const { espacoId } = await f.sala();
    await expect(db.insert(schema.pacoteCredito).values({ espacoId, nome: 'Ruim', valorPagoCentavos: 5000, valorCreditoCentavos: 4000 })).rejects.toThrow();
  });
});

describe('recibo', () => {
  it('é numerado em sequência, emitido uma vez por cobrança, e o PDF traz os dados', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const a = await f.profissional();
    const b = await f.profissional();
    const idA = await pedir(espacoId, a, 9, 10, 2);
    const idB = await pedir(espacoId, b, 13, 14, 2);
    await aprovarReserva(idA, anf, {}, agora);
    await aprovarReserva(idB, anf, {}, agora);
    const cA = await cobrancaDe(a);
    const cB = await cobrancaDe(b);
    await aplicarEventoAsaas(evento(cA), agora);
    await aplicarEventoAsaas(evento(cB), agora);

    const [rA] = await db.select().from(schema.recibo).where(eq(schema.recibo.cobrancaId, cA.id));
    const [rB] = await db.select().from(schema.recibo).where(eq(schema.recibo.cobrancaId, cB.id));
    expect(rB.numero).toBeGreaterThan(rA.numero);
    expect((await emitirRecibo(cA.id))!.numero).toBe(rA.numero); // não renumera

    process.env.RECIBO_EMITENTE_NOME = 'Anfitrião de Teste';
    const dados = (await carregarRecibo(rA.id))!;
    expect(dados).toMatchObject({ numero: rA.numero, valorPagoCentavos: 5000, profissionalId: a });
    expect(dados.itens[0]).toContain('Reserva da sala');
    const pdf = await gerarPdfRecibo(dados);
    expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it('cobrança não paga ou paga só com crédito não tem recibo', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    await aprovarReserva(await pedir(espacoId, prof), anf, {}, agora);
    expect(await emitirRecibo((await cobrancaDe(prof)).id)).toBeNull();
  });
});
