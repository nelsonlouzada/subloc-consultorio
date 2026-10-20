import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool, schema } from '@/db';

const enviarEmail = vi.fn<(para: string, assunto: string, html: string) => Promise<void>>();
vi.mock('@/lib/email', () => ({ enviarEmail: (...a: [string, string, string]) => enviarEmail(...a) }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

import { instanteLocal } from '@/lib/fuso';
import { garantirDocumentosIniciais } from '@/modulos/configuracao/documentos-iniciais';
import { criarReserva, MAX_PEDIDOS_ABERTOS, type PedidoReserva } from './reserva';

const sufixo = randomUUID().slice(0, 8);
const usuarios: string[] = [];
const espacos: string[] = [];
let contador = 0;

// "Agora" fixo: 20/10/2026 ao meio-dia. Segunda 02/11 e as datas dos testes ficam na janela de 60 dias.
const agora = instanteLocal(2026, 10, 20, 12);
const h = (hora: number, dia = 2) => instanteLocal(2026, 11, dia, hora); // dia 2 = segunda
const ctx = { ip: '203.0.113.7', userAgent: 'vitest' };

async function novoProfissional(status: 'pendente' | 'aprovado' | 'recusado' | 'bloqueado' = 'aprovado') {
  const n = ++contador;
  const id = `teste-res-${sufixo}-${n}`;
  usuarios.push(id);
  await db.insert(schema.usuario).values({ id, name: `Profissional ${n}`, email: `${id}@example.com` });
  await db.insert(schema.profissional).values({
    usuarioId: id,
    cpf: `7${sufixo.replace(/\D/g, '0').padEnd(5, '0').slice(0, 5)}${String(n).padStart(5, '0')}`,
    profissao: 'psicologo',
    conselho: 'CRP',
    registroNumero: String(n),
    registroUf: 'SP',
    status,
  });
  return id;
}

/** Sala completa: regras, turnos 07-12 e 13-22 e preços iniciais (hora 50, turnos 200/300, dia 450). */
async function novaSala() {
  const [e] = await db.insert(schema.espaco).values({ nome: 'Sala de teste', slug: `teste-${randomUUID()}` }).returning({ id: schema.espaco.id });
  espacos.push(e.id);
  await db.insert(schema.regraEspaco).values({
    espacoId: e.id,
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
      { espacoId: e.id, nome: 'Turno 1', inicio: '07:00', fim: '12:00', ordem: 1 },
      { espacoId: e.id, nome: 'Turno 2', inicio: '13:00', fim: '22:00', ordem: 2 },
    ])
    .returning({ id: schema.turno.id });
  await db.insert(schema.preco).values([
    { espacoId: e.id, unidade: 'hora', valorCentavos: 5000 },
    { espacoId: e.id, unidade: 'turno', turnoId: t1.id, valorCentavos: 20000 },
    { espacoId: e.id, unidade: 'turno', turnoId: t2.id, valorCentavos: 30000 },
    { espacoId: e.id, unidade: 'dia', valorCentavos: 45000 },
  ]);
  return { espacoId: e.id, turno1: t1.id, turno2: t2.id };
}

const hora = (espacoId: string, profissionalId: string, de: number, ate: number, dia = 2): PedidoReserva => ({
  espacoId,
  profissionalId,
  inicio: h(de, dia),
  fim: h(ate, dia),
  unidade: 'hora',
});

const reservasDe = (espacoId: string) => db.select().from(schema.reserva).where(eq(schema.reserva.espacoId, espacoId));

beforeAll(async () => {
  await garantirDocumentosIniciais();
});

beforeEach(() => {
  enviarEmail.mockReset();
  enviarEmail.mockResolvedValue(undefined);
});

afterAll(async () => {
  const reservas = espacos.length
    ? await db.select({ id: schema.reserva.id }).from(schema.reserva).where(inArray(schema.reserva.espacoId, espacos))
    : [];
  const ids = reservas.map((r) => r.id);
  if (ids.length) await db.delete(schema.notificacao).where(inArray(schema.notificacao.referenciaId, ids));
  if (usuarios.length) {
    await db.delete(schema.aceite).where(inArray(schema.aceite.usuarioId, usuarios));
    await db.delete(schema.eventoAuditoria).where(inArray(schema.eventoAuditoria.usuarioId, usuarios));
  }
  for (const e of espacos) await db.delete(schema.espaco).where(eq(schema.espaco.id, e));
  if (usuarios.length) {
    await db.delete(schema.profissional).where(inArray(schema.profissional.usuarioId, usuarios));
    await db.delete(schema.usuario).where(inArray(schema.usuario.id, usuarios));
  }
  await pool.end();
});

describe('criar reserva', () => {
  it('retém o horário: reserva solicitada, valor do menor preço, ocupação e aceite do termo', async () => {
    const { espacoId } = await novaSala();
    const prof = await novoProfissional();
    const r = await criarReserva(hora(espacoId, prof, 9, 12), ctx, agora);
    expect(r).toMatchObject({ ok: true, valorCentavos: 15000 }); // 3h no turno 1: min(150, 200)
    if (!r.ok) return;

    const [res] = await db.select().from(schema.reserva).where(eq(schema.reserva.id, r.reservaId));
    expect(res).toMatchObject({ status: 'solicitada', unidade: 'hora', valorCentavos: 15000, valorCheioCentavos: 15000, descontoCentavos: 0 });
    expect(res.inicio.toISOString()).toBe(h(9).toISOString());

    const oc = await db.select().from(schema.ocupacao).where(eq(schema.ocupacao.reservaId, r.reservaId));
    expect(oc).toHaveLength(1);
    expect(oc[0]).toMatchObject({ ocupante: `prof:${prof}`, geraTrava: true });

    const [ac] = await db.select().from(schema.aceite).where(eq(schema.aceite.reservaId, r.reservaId));
    expect(ac).toMatchObject({ usuarioId: prof, ip: '203.0.113.7' });
    const [doc] = await db.select().from(schema.documentoLegal).where(eq(schema.documentoLegal.id, ac.documentoId));
    expect(doc.tipo).toBe('termo_reserva');
  });

  it('o pendente já pode pedir (D2); recusado e bloqueado, não', async () => {
    const { espacoId } = await novaSala();
    expect((await criarReserva(hora(espacoId, await novoProfissional('pendente'), 9, 10), ctx, agora)).ok).toBe(true);
    for (const status of ['recusado', 'bloqueado'] as const) {
      const r = await criarReserva(hora(espacoId, await novoProfissional(status), 15, 16), ctx, agora);
      expect(r).toEqual({ ok: false, erro: 'profissional_nao_pode' });
    }
    expect(await reservasDe(espacoId)).toHaveLength(1);
  });

  it('avisa os Anfitriões por e-mail, sem derrubar o pedido se o envio falhar', async () => {
    const { espacoId } = await novaSala();
    const prof = await novoProfissional();
    enviarEmail.mockRejectedValue(new Error('Resend fora do ar'));
    const r = await criarReserva(hora(espacoId, prof, 9, 10), ctx, agora);
    expect(r.ok).toBe(true);
  });
});

describe('unidade, preço e prazos', () => {
  it('turno inteiro custa o preço do turno; dia inteiro, o do dia', async () => {
    const { espacoId, turno1, turno2 } = await novaSala();
    const prof = await novoProfissional();
    const t1 = await criarReserva({ espacoId, profissionalId: prof, inicio: h(7), fim: h(12), unidade: 'turno', turnoId: turno1 }, ctx, agora);
    const t2 = await criarReserva({ espacoId, profissionalId: prof, inicio: h(13, 3), fim: h(22, 3), unidade: 'turno', turnoId: turno2 }, ctx, agora);
    const dia = await criarReserva({ espacoId, profissionalId: prof, inicio: h(7, 4), fim: h(22, 4), unidade: 'dia' }, ctx, agora);
    expect(t1).toMatchObject({ ok: true, valorCentavos: 20000 });
    expect(t2).toMatchObject({ ok: true, valorCentavos: 30000 });
    expect(dia).toMatchObject({ ok: true, valorCentavos: 45000 });
  });

  it('unidade que não bate com o horário é recusada', async () => {
    const { espacoId, turno1 } = await novaSala();
    const prof = await novoProfissional();
    // "turno 1" com horário de 8h às 12h; "dia" de 9h às 22h; turno de outra sala
    expect(await criarReserva({ espacoId, profissionalId: prof, inicio: h(8), fim: h(12), unidade: 'turno', turnoId: turno1 }, ctx, agora)).toEqual({ ok: false, erro: 'unidade_invalida' });
    expect(await criarReserva({ espacoId, profissionalId: prof, inicio: h(9), fim: h(22), unidade: 'dia' }, ctx, agora)).toEqual({ ok: false, erro: 'unidade_invalida' });
    const outra = await novaSala();
    expect(await criarReserva({ espacoId, profissionalId: prof, inicio: h(7), fim: h(12), unidade: 'turno', turnoId: outra.turno1 }, ctx, agora)).toEqual({ ok: false, erro: 'unidade_invalida' });
    expect(await criarReserva({ espacoId, profissionalId: prof, inicio: h(7), fim: h(12), unidade: 'turno' }, ctx, agora)).toEqual({ ok: false, erro: 'unidade_invalida' });
    expect(await reservasDe(espacoId)).toHaveLength(0);
  });

  it('prazo de aprovação: 12 horas, mas nunca depois de 6 horas antes do início (D3)', async () => {
    const { espacoId } = await novaSala();
    const prof = await novoProfissional();
    const prazoDe = async (r: Awaited<ReturnType<typeof criarReserva>>) => {
      if (!r.ok) throw new Error(`esperava ok, veio ${r.erro}`);
      const [res] = await db.select().from(schema.reserva).where(eq(schema.reserva.id, r.reservaId));
      return res.prazoAprovacaoAte!.getTime();
    };
    // Início daqui a 13 dias: vale o prazo de 12 horas (é menor que "início menos 6 horas").
    expect(await prazoDe(await criarReserva(hora(espacoId, prof, 9, 10), ctx, agora))).toBe(agora.getTime() + 12 * 3_600_000);
    // Início 26 horas depois do pedido: 12 horas ainda cabe (o corte seria 20 horas depois).
    const quando = instanteLocal(2026, 11, 1, 10);
    expect(await prazoDe(await criarReserva(hora(espacoId, prof, 12, 13), ctx, quando))).toBe(quando.getTime() + 12 * 3_600_000);
  });

  it('o prazo nunca passa de 6 horas antes do início, mesmo com prazo configurado maior', async () => {
    const { espacoId } = await novaSala();
    await db.update(schema.regraEspaco).set({ prazoAprovacaoHoras: 48 }).where(eq(schema.regraEspaco.espacoId, espacoId));
    const prof = await novoProfissional();
    // Início 26 horas depois do pedido: 48 horas passaria do início, então vale "início menos 6 horas".
    const quando = instanteLocal(2026, 11, 1, 10);
    const r = await criarReserva(hora(espacoId, prof, 12, 13), ctx, quando);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [res] = await db.select().from(schema.reserva).where(eq(schema.reserva.id, r.reservaId));
    expect(res.prazoAprovacaoAte!.getTime()).toBe(res.inicio.getTime() - 6 * 3_600_000);
  });
});

describe('regras e conflitos', () => {
  it.each([
    ['domingo', (e: string, p: string) => hora(e, p, 9, 10, 1), 'fechado'],
    ['antes das 7h', (e: string, p: string) => hora(e, p, 6, 8), 'fora_do_horario'],
    ['depois das 22h', (e: string, p: string) => hora(e, p, 21, 23), 'fora_do_horario'],
    ['com menos de 24h', (e: string, p: string) => ({ ...hora(e, p, 9, 10), inicio: instanteLocal(2026, 10, 21, 9), fim: instanteLocal(2026, 10, 21, 10) }), 'antecedencia_minima'],
    ['com mais de 60 dias', (e: string, p: string) => ({ ...hora(e, p, 9, 10), inicio: instanteLocal(2027, 1, 4, 9), fim: instanteLocal(2027, 1, 4, 10) }), 'antecedencia_maxima'],
    ['em horas quebradas', (e: string, p: string) => ({ ...hora(e, p, 9, 10), inicio: instanteLocal(2026, 11, 2, 9, 30), fim: instanteLocal(2026, 11, 2, 10, 30) }), 'horas_cheias'],
  ] as const)('recusa pedido %s', async (_nome, monta, motivo) => {
    const { espacoId } = await novaSala();
    const prof = await novoProfissional();
    expect(await criarReserva(monta(espacoId, prof), ctx, agora)).toEqual({ ok: false, erro: motivo });
    expect(await reservasDe(espacoId)).toHaveLength(0);
  });

  it('mesmo horário de outro Profissional: ocupado; colado nele: trava; nada fica pela metade', async () => {
    const { espacoId } = await novaSala();
    const a = await novoProfissional();
    const b = await novoProfissional();
    expect((await criarReserva(hora(espacoId, a, 9, 10), ctx, agora)).ok).toBe(true);
    expect(await criarReserva(hora(espacoId, b, 9, 10), ctx, agora)).toEqual({ ok: false, erro: 'ocupado' });
    expect(await criarReserva(hora(espacoId, b, 10, 11), ctx, agora)).toEqual({ ok: false, erro: 'trava' });
    expect(await criarReserva(hora(espacoId, b, 11, 12), ctx, agora)).toMatchObject({ ok: true });
    expect(await reservasDe(espacoId)).toHaveLength(2);
  });

  it('o mesmo Profissional emenda horas sem trava', async () => {
    const { espacoId } = await novaSala();
    const a = await novoProfissional();
    expect((await criarReserva(hora(espacoId, a, 9, 10), ctx, agora)).ok).toBe(true);
    expect((await criarReserva(hora(espacoId, a, 10, 11), ctx, agora)).ok).toBe(true);
  });

  it('dois pedidos simultâneos pelo mesmo horário: só um é aceito', async () => {
    const { espacoId } = await novaSala();
    const a = await novoProfissional();
    const b = await novoProfissional();
    const [ra, rb] = await Promise.all([
      criarReserva(hora(espacoId, a, 9, 10), ctx, agora),
      criarReserva(hora(espacoId, b, 9, 10), ctx, agora),
    ]);
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1);
    const perdeu = ra.ok ? rb : ra;
    expect(perdeu.ok === false && ['ocupado', 'trava']).toBeTruthy();
    expect(await reservasDe(espacoId)).toHaveLength(1);
    const oc = await db.select().from(schema.ocupacao).where(eq(schema.ocupacao.espacoId, espacoId));
    expect(oc).toHaveLength(1);
  });

  it(`limita os pedidos em aberto a ${MAX_PEDIDOS_ABERTOS} por Profissional`, async () => {
    const { espacoId } = await novaSala();
    const a = await novoProfissional();
    for (let i = 0; i < MAX_PEDIDOS_ABERTOS; i++) {
      expect((await criarReserva(hora(espacoId, a, 9, 10, 2 + i), ctx, agora)).ok).toBe(true); // dias diferentes
    }
    expect(await criarReserva(hora(espacoId, a, 9, 10, 9), ctx, agora)).toEqual({ ok: false, erro: 'limite_pedidos' });
    // Outro Profissional não é afetado.
    expect((await criarReserva(hora(espacoId, await novoProfissional(), 15, 16, 9), ctx, agora)).ok).toBe(true);
  });

  it('um pedido recusado deixa de contar para o teto e libera o horário', async () => {
    const { espacoId } = await novaSala();
    const a = await novoProfissional();
    const b = await novoProfissional();
    const r = await criarReserva(hora(espacoId, a, 9, 10), ctx, agora);
    if (!r.ok) throw new Error('esperava ok');
    await db.update(schema.reserva).set({ status: 'recusada' }).where(eq(schema.reserva.id, r.reservaId));
    await db.delete(schema.ocupacao).where(eq(schema.ocupacao.reservaId, r.reservaId));
    expect((await criarReserva(hora(espacoId, b, 9, 10), ctx, agora)).ok).toBe(true);
  });
});
