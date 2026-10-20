import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool, schema } from '@/db';

const enviarEmail = vi.fn<(para: string, assunto: string, html: string) => Promise<void>>();
vi.mock('@/lib/email', () => ({ enviarEmail: (...a: [string, string, string]) => enviarEmail(...a) }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

import { instanteLocal } from '@/lib/fuso';
import { registrarOcupacao } from '@/modulos/agenda/ocupacao';
import {
  aprovarProfissional,
  bloquearProfissional,
  desbloquearProfissional,
  listarProfissionais,
  obterProfissional,
  ProfissionalNaoEncontradoError,
  recusarProfissional,
  TransicaoInvalidaError,
} from './aprovacao';

const sufixo = randomUUID().slice(0, 8);
const anfitriaoId = `teste-aprov-anf-${sufixo}`;
const usuarios: string[] = [anfitriaoId];
const espacos: string[] = [];
let contador = 0;

async function novoProfissional(status: 'pendente' | 'aprovado' | 'recusado' | 'bloqueado' = 'pendente') {
  const n = ++contador;
  const id = `teste-aprov-${sufixo}-${n}`;
  usuarios.push(id);
  await db.insert(schema.usuario).values({ id, name: `Profissional ${n}`, email: `${id}@example.com` });
  await db.insert(schema.profissional).values({
    usuarioId: id,
    cpf: `9${sufixo.replace(/\D/g, '0').slice(0, 5)}${String(n).padStart(5, '0')}`.slice(0, 11),
    profissao: 'psicologo',
    conselho: 'CRP',
    registroNumero: `${n}`.padStart(5, '0'),
    registroUf: 'SP',
    status,
  });
  return id;
}

beforeAll(async () => {
  await db.insert(schema.usuario).values({ id: anfitriaoId, name: 'Anfitrião', email: `${anfitriaoId}@example.com`, papel: 'anfitriao' });
});

beforeEach(() => {
  enviarEmail.mockReset();
  enviarEmail.mockResolvedValue(undefined);
});

afterAll(async () => {
  for (const e of espacos) await db.delete(schema.espaco).where(eq(schema.espaco.id, e)); // reservas e ocupações em cascata
  await db.delete(schema.notificacao).where(inArray(schema.notificacao.referenciaId, usuarios));
  await db.delete(schema.eventoAuditoria).where(inArray(schema.eventoAuditoria.entidadeId, usuarios));
  await db.delete(schema.eventoAuditoria).where(inArray(schema.eventoAuditoria.usuarioId, usuarios));
  // Os cadastros apontam para o Anfitrião (avaliado_por): saem primeiro.
  await db.delete(schema.profissional).where(inArray(schema.profissional.usuarioId, usuarios));
  await db.delete(schema.usuario).where(inArray(schema.usuario.id, usuarios));
  await pool.end();
});

describe('estados do cadastro', () => {
  it('aprova um pendente, avisa por e-mail e audita quem aprovou', async () => {
    const id = await novoProfissional();
    await aprovarProfissional(id, anfitriaoId, '203.0.113.1');
    const p = await obterProfissional(id);
    expect(p).toMatchObject({ status: 'aprovado' });
    expect(p?.avaliadoEm).toBeInstanceOf(Date);
    expect(enviarEmail).toHaveBeenCalledWith(`${id}@example.com`, 'Seu cadastro foi aprovado', expect.any(String));
    const [ev] = await db.select().from(schema.eventoAuditoria).where(eq(schema.eventoAuditoria.entidadeId, id));
    expect(ev).toMatchObject({ usuarioId: anfitriaoId, acao: 'profissional_aprovado', ip: '203.0.113.1' });
  });

  it('recusa com motivo e o motivo vai no e-mail, escapado', async () => {
    const id = await novoProfissional();
    await recusarProfissional(id, anfitriaoId, 'Registro <b>não confere</b>');
    expect(await obterProfissional(id)).toMatchObject({ status: 'recusado', motivoAvaliacao: 'Registro <b>não confere</b>' });
    const html = enviarEmail.mock.calls[0][2];
    expect(html).toContain('&lt;b&gt;não confere&lt;/b&gt;');
    expect(html).not.toContain('<b>não confere</b>');
  });

  it('um recusado pode ser reconsiderado e aprovado', async () => {
    const id = await novoProfissional('recusado');
    await aprovarProfissional(id, anfitriaoId);
    expect((await obterProfissional(id))?.status).toBe('aprovado');
  });

  it('bloqueia e desbloqueia sem mandar e-mail de aprovação de novo', async () => {
    const id = await novoProfissional('aprovado');
    await bloquearProfissional(id, anfitriaoId, 'Descumpriu o contrato');
    expect((await obterProfissional(id))?.status).toBe('bloqueado');
    await desbloquearProfissional(id, anfitriaoId);
    expect((await obterProfissional(id))?.status).toBe('aprovado');
    expect(enviarEmail).not.toHaveBeenCalled();
  });

  it.each([
    ['aprovar quem já está aprovado', 'aprovado', aprovarProfissional],
    ['bloquear um pendente', 'pendente', (id: string, por: string) => bloquearProfissional(id, por, null)],
    ['recusar quem já foi aprovado', 'aprovado', (id: string, por: string) => recusarProfissional(id, por, null)],
  ] as const)('recusa a transição: %s', async (_nome, inicial, acao) => {
    const id = await novoProfissional(inicial);
    await expect(acao(id, anfitriaoId)).rejects.toThrow(TransicaoInvalidaError);
    expect(enviarEmail).not.toHaveBeenCalled();
  });

  it('profissional inexistente é erro claro', async () => {
    await expect(aprovarProfissional('nao-existe', anfitriaoId)).rejects.toThrow(ProfissionalNaoEncontradoError);
  });

  it('duas decisões ao mesmo tempo: só uma vale, e só um e-mail sai', async () => {
    const id = await novoProfissional();
    const resultados = await Promise.allSettled([
      aprovarProfissional(id, anfitriaoId),
      recusarProfissional(id, anfitriaoId, 'duplicado'),
    ]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(enviarEmail).toHaveBeenCalledTimes(1);
  });
});

describe('recusar o cadastro libera os horários pedidos', () => {
  it('recusa os pedidos em aberto e o horário volta a ficar livre para outra pessoa', async () => {
    const [e] = await db.insert(schema.espaco).values({ nome: 'Sala', slug: `teste-${randomUUID()}` }).returning({ id: schema.espaco.id });
    espacos.push(e.id);
    const id = await novoProfissional();
    const h = (hora: number) => instanteLocal(2026, 11, 2, hora);

    const pedir = async (de: number, ate: number, status: 'solicitada' | 'confirmada') =>
      db.transaction(async (tx) => {
        const [r] = await tx
          .insert(schema.reserva)
          .values({ espacoId: e.id, profissionalId: id, inicio: h(de), fim: h(ate), unidade: 'hora', valorCheioCentavos: 5000, valorCentavos: 5000, status })
          .returning({ id: schema.reserva.id });
        await registrarOcupacao(tx, { espacoId: e.id, inicio: h(de), fim: h(ate), ocupante: `prof:${id}`, geraTrava: true, travaMinutos: 60, reservaId: r.id });
        return r.id;
      });

    const aberta = await pedir(9, 10, 'solicitada');
    const confirmada = await pedir(15, 16, 'confirmada');

    await recusarProfissional(id, anfitriaoId, null);

    const [ra] = await db.select().from(schema.reserva).where(eq(schema.reserva.id, aberta));
    const [rc] = await db.select().from(schema.reserva).where(eq(schema.reserva.id, confirmada));
    expect(ra.status).toBe('recusada');
    expect(rc.status).toBe('confirmada'); // reserva já confirmada e paga não é mexida aqui

    // O horário do pedido recusado voltou a ficar livre.
    const outro = await novoProfissional('aprovado');
    await expect(
      db.transaction(async (tx) => {
        const [r] = await tx
          .insert(schema.reserva)
          .values({ espacoId: e.id, profissionalId: outro, inicio: h(9), fim: h(10), unidade: 'hora', valorCheioCentavos: 5000, valorCentavos: 5000 })
          .returning({ id: schema.reserva.id });
        await registrarOcupacao(tx, { espacoId: e.id, inicio: h(9), fim: h(10), ocupante: `prof:${outro}`, geraTrava: true, travaMinutos: 60, reservaId: r.id });
      }),
    ).resolves.toBeUndefined();
  });
});

describe('listagem', () => {
  it('filtra por estado', async () => {
    const pendente = await novoProfissional('pendente');
    const aprovado = await novoProfissional('aprovado');
    const soPendentes = (await listarProfissionais('pendente')).map((p) => p.id);
    expect(soPendentes).toContain(pendente);
    expect(soPendentes).not.toContain(aprovado);
    expect((await listarProfissionais()).map((p) => p.id)).toEqual(expect.arrayContaining([pendente, aprovado]));
  });
});
