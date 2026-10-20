import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool, schema } from '@/db';

const enviarEmail = vi.fn<(para: string, assunto: string, html: string) => Promise<void>>();
vi.mock('@/lib/email', () => ({ enviarEmail: (...a: [string, string, string]) => enviarEmail(...a) }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

import { instanteLocal } from '@/lib/fuso';
import { fabrica } from '@/test/fabrica';
import { garantirDocumentosIniciais } from '@/modulos/configuracao/documentos-iniciais';
import { expirarPrazos } from './expiracao';
import { criarReserva, type PedidoReserva } from './reserva';
import {
  aprovarReserva,
  CadastroPendenteError,
  contarSolicitacoes,
  EstadoReservaError,
  listarSolicitacoes,
  PrazoVencidoError,
  recusarReserva,
  ReservaNaoEncontradaError,
} from './solicitacao';

const f = fabrica();
const ctx = { ip: '203.0.113.5', userAgent: 'vitest' };
const agora = instanteLocal(2026, 10, 20, 12);
const h = (hora: number, dia = 2) => instanteLocal(2026, 11, dia, hora);
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

beforeAll(async () => {
  await garantirDocumentosIniciais();
});
beforeEach(() => {
  enviarEmail.mockReset();
  enviarEmail.mockResolvedValue(undefined);
  process.env.PIX_MANUAL_CHAVE = 'chave-pix-teste@example.com';
  process.env.PIX_MANUAL_NOME = 'Favorecido Teste';
});
afterAll(async () => {
  await f.limpar();
  await pool.end();
});

describe('aprovar', () => {
  it('passa a aguardar pagamento, cria a cobrança e manda os dados do Pix', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const id = await pedir(espacoId, prof);

    const { prazoPagamentoAte } = await aprovarReserva(id, anf, { ip: '203.0.113.9' }, agora);
    expect(prazoPagamentoAte.getTime()).toBe(agora.getTime() + 2 * 3_600_000);

    expect(await reserva(id)).toMatchObject({ status: 'aguardando_pagamento', aprovadaPor: anf });
    expect((await ocupacoes(id)).length).toBe(1); // o horário continua retido

    const [c] = await db.select().from(schema.cobranca).where(eq(schema.cobranca.profissionalId, prof));
    expect(c).toMatchObject({ status: 'pendente', finalidade: 'reserva', valorCobradoCentavos: 5000, meio: null });
    expect(c.venceEm?.getTime()).toBe(prazoPagamentoAte.getTime());
    const itens = await db.select().from(schema.cobrancaItem).where(eq(schema.cobrancaItem.cobrancaId, c.id));
    expect(itens).toEqual([expect.objectContaining({ reservaId: id, valorCentavos: 5000 })]);

    const email = enviarEmail.mock.calls.find((c) => c[0] === `${prof}@example.com`)!;
    expect(email[1]).toContain('aprovada');
    expect(email[2]).toContain('R$ 50,00');
    expect(email[2]).toContain('chave-pix-teste@example.com');
    expect(email[2]).toContain('Favorecido Teste');
  });

  it('sem chave Pix configurada, o e-mail avisa que os dados virão dos responsáveis', async () => {
    delete process.env.PIX_MANUAL_CHAVE;
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    const id = await pedir(espacoId, prof);
    await aprovarReserva(id, await f.anfitriao(), {}, agora);
    const email = enviarEmail.mock.calls.find((c) => c[0] === `${prof}@example.com`)!;
    expect(email[2]).toContain('vão enviar os dados do pagamento');
  });

  it('o prazo de pagamento nunca passa de 6 horas antes do início (D3)', async () => {
    const { espacoId } = await f.sala({ prazoAprovacaoHoras: 48 });
    const prof = await f.profissional();
    const quando = instanteLocal(2026, 11, 1, 10);
    const id = await pedir(espacoId, prof, 12, 13, 2, quando); // início 02/11 às 12h; prazo de aprovação: 06h do dia 02
    const aprovando = instanteLocal(2026, 11, 2, 5); // 1h antes do fim do prazo de aprovação
    const { prazoPagamentoAte } = await aprovarReserva(id, await f.anfitriao(), {}, aprovando);
    // 5h + 2h = 7h passaria do corte (06h): vale 06h.
    expect(prazoPagamentoAte.getTime()).toBe(instanteLocal(2026, 11, 2, 6).getTime());
  });

  it('cadastro pendente: só aprova junto com o cadastro', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional('pendente');
    const id = await pedir(espacoId, prof);

    await expect(aprovarReserva(id, anf, {}, agora)).rejects.toThrow(CadastroPendenteError);
    expect((await reserva(id)).status).toBe('solicitada');

    await aprovarReserva(id, anf, { aprovarCadastro: true }, agora);
    expect((await reserva(id)).status).toBe('aguardando_pagamento');
    const [p] = await db.select().from(schema.profissional).where(eq(schema.profissional.usuarioId, prof));
    expect(p.status).toBe('aprovado');
  });

  it('depois do prazo de aprovação já não aprova', async () => {
    const { espacoId } = await f.sala();
    const prof = await f.profissional();
    const id = await pedir(espacoId, prof);
    const tarde = new Date(agora.getTime() + 13 * 3_600_000);
    await expect(aprovarReserva(id, await f.anfitriao(), {}, tarde)).rejects.toThrow(PrazoVencidoError);
    expect((await reserva(id)).status).toBe('solicitada');
  });

  it('aprovar duas vezes, ou algo que não existe, é erro claro', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const id = await pedir(espacoId, await f.profissional());
    await aprovarReserva(id, anf, {}, agora);
    await expect(aprovarReserva(id, anf, {}, agora)).rejects.toThrow(EstadoReservaError);
    await expect(aprovarReserva('00000000-0000-0000-0000-000000000000', anf, {}, agora)).rejects.toThrow(ReservaNaoEncontradaError);
  });

  it('duas decisões ao mesmo tempo (aprovar e recusar): só uma vale', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const id = await pedir(espacoId, await f.profissional());
    const r = await Promise.allSettled([aprovarReserva(id, anf, {}, agora), recusarReserva(id, anf, 'x')]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const { status } = await reserva(id);
    expect(['aguardando_pagamento', 'recusada']).toContain(status);
    // Estado e horário coerentes: recusada libera, aprovada retém.
    expect((await ocupacoes(id)).length).toBe(status === 'recusada' ? 0 : 1);
  });
});

describe('recusar', () => {
  it('libera o horário na hora, guarda o motivo e avisa (com o texto escapado)', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const a = await f.profissional();
    const b = await f.profissional();
    const id = await pedir(espacoId, a);

    await recusarReserva(id, anf, 'Sala em <b>manutenção</b>');
    expect(await reserva(id)).toMatchObject({ status: 'recusada', motivoRecusa: 'Sala em <b>manutenção</b>' });
    expect(await ocupacoes(id)).toHaveLength(0);

    const html = enviarEmail.mock.calls.find((c) => c[0] === `${a}@example.com`)![2];
    expect(html).toContain('&lt;b&gt;manutenção&lt;/b&gt;');
    expect(html).not.toContain('<b>manutenção</b>');

    // O mesmo horário volta a poder ser pedido por outra pessoa.
    await expect(pedir(espacoId, b)).resolves.toBeTruthy();
  });

  it('não recusa o que já foi decidido', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const id = await pedir(espacoId, await f.profissional());
    await aprovarReserva(id, anf, {}, agora);
    await expect(recusarReserva(id, anf, null)).rejects.toThrow(EstadoReservaError);
  });
});

describe('listar e contar', () => {
  it('lista os pedidos com o histórico do Profissional e conta os que esperam decisão', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const a = await pedir(espacoId, prof, 9, 10, 2);
    const b = await pedir(espacoId, prof, 9, 10, 3);
    await aprovarReserva(b, anf, {}, agora);

    expect(await contarSolicitacoes(espacoId)).toBe(1);
    const lista = await listarSolicitacoes(espacoId);
    expect(lista.map((x) => [x.id, x.status])).toEqual([
      [a, 'solicitada'],
      [b, 'aguardando_pagamento'],
    ]);
    expect(lista[0]).toMatchObject({ profissionalStatus: 'aprovado', realizadas: 0, faltas: 0 });
  });
});

describe('expiração de prazos', () => {
  it('pedido sem aprovação expira, libera o horário e avisa uma única vez', async () => {
    const { espacoId } = await f.sala();
    const a = await f.profissional();
    const b = await f.profissional();
    const id = await pedir(espacoId, a);
    const depois = new Date(agora.getTime() + 13 * 3_600_000);

    // A varredura é global (pega o banco inteiro), então só conferimos que incluiu este pedido.
    expect((await expirarPrazos(depois)).aprovacao).toBeGreaterThanOrEqual(1);
    expect((await reserva(id)).status).toBe('expirada');
    expect(await ocupacoes(id)).toHaveLength(0);
    const avisos = enviarEmail.mock.calls.filter((c) => c[0] === `${a}@example.com` && c[1].includes('expirou'));
    expect(avisos).toHaveLength(1);

    // Rodar de novo não faz nada nem manda e-mail em dobro.
    expect(await expirarPrazos(depois)).toEqual({ aprovacao: 0, pagamento: 0 });
    expect(enviarEmail.mock.calls.filter((c) => c[0] === `${a}@example.com` && c[1].includes('expirou'))).toHaveLength(1);

    await expect(pedir(espacoId, b)).resolves.toBeTruthy(); // horário livre de novo
  });

  it('antes do prazo não mexe em nada', async () => {
    const { espacoId } = await f.sala();
    const id = await pedir(espacoId, await f.profissional());
    expect(await expirarPrazos(new Date(agora.getTime() + 11 * 3_600_000))).toEqual({ aprovacao: 0, pagamento: 0 });
    expect((await reserva(id)).status).toBe('solicitada');
  });

  it('aprovado e não pago expira junto com a cobrança e libera o horário', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const a = await f.profissional();
    const id = await pedir(espacoId, a);
    await aprovarReserva(id, anf, {}, agora); // paga até agora + 2h

    expect((await expirarPrazos(new Date(agora.getTime() + 3 * 3_600_000))).pagamento).toBeGreaterThanOrEqual(1);
    expect((await reserva(id)).status).toBe('expirada');
    expect(await ocupacoes(id)).toHaveLength(0);
    const [c] = await db.select().from(schema.cobranca).where(eq(schema.cobranca.profissionalId, a));
    expect(c.status).toBe('expirada');
    await expect(pedir(espacoId, await f.profissional())).resolves.toBeTruthy();
  });

  it('reserva confirmada nunca expira, por mais velho que seja o prazo', async () => {
    const { espacoId } = await f.sala();
    const id = await pedir(espacoId, await f.profissional());
    await db.update(schema.reserva).set({ status: 'confirmada', prazoPagamentoAte: agora }).where(eq(schema.reserva.id, id));
    await expirarPrazos(new Date(agora.getTime() + 86_400_000));
    expect((await reserva(id)).status).toBe('confirmada');
    expect(await ocupacoes(id)).toHaveLength(1);
  });

  it('dois processos expirando ao mesmo tempo: cada reserva expira uma vez só', async () => {
    const { espacoId } = await f.sala();
    const a = await f.profissional();
    await pedir(espacoId, a, 9, 10, 2);
    await pedir(espacoId, a, 9, 10, 3);
    const depois = new Date(agora.getTime() + 13 * 3_600_000);
    const [r1, r2] = await Promise.all([expirarPrazos(depois), expirarPrazos(depois)]);
    expect(r1.aprovacao + r2.aprovacao).toBeGreaterThanOrEqual(2);
    // Mesmo com dois processos, cada reserva desta pessoa expirou e foi avisada uma única vez.
    const avisos = enviarEmail.mock.calls.filter((c) => c[0] === `${a}@example.com` && c[1].includes('expirou'));
    expect(avisos).toHaveLength(2);
  });
});
