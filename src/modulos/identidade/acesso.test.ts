import { randomUUID } from 'node:crypto';
import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool, schema } from '@/db';

const enviarEmail = vi.fn<(para: string, assunto: string, html: string) => Promise<void>>();
vi.mock('@/lib/email', () => ({ enviarEmail: (...a: [string, string, string]) => enviarEmail(...a) }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

import { auth } from '@/lib/auth';
import { fabrica } from '@/test/fabrica';
import { AcessoInvalidoError, contaAtiva, desativarAcesso, reativarAcesso } from './acesso';

const f = fabrica();
const prefixo = `teste-acesso-${randomUUID().slice(0, 8)}`;
const SENHA = 'senha-de-teste-123';
let n = 0;

beforeEach(() => {
  enviarEmail.mockReset();
  enviarEmail.mockResolvedValue(undefined);
});
afterAll(async () => {
  const contas = await db.select({ id: schema.usuario.id }).from(schema.usuario).where(like(schema.usuario.email, `${prefixo}%`));
  for (const c of contas) {
    await db.delete(schema.eventoAuditoria).where(eq(schema.eventoAuditoria.entidadeId, c.id));
    await db.delete(schema.profissional).where(eq(schema.profissional.usuarioId, c.id));
  }
  await db.delete(schema.usuario).where(like(schema.usuario.email, `${prefixo}%`));
  await f.limpar();
  await pool.end();
});

/** Profissional com conta de verdade na biblioteca de login (senha, e-mail confirmado). */
async function profissionalComLogin() {
  const email = `${prefixo}-${++n}@example.com`;
  await auth.api.signUpEmail({ body: { email, name: 'Fulana de Teste', password: SENHA } });
  const [u] = await db.update(schema.usuario).set({ emailVerified: true }).where(eq(schema.usuario.email, email)).returning({ id: schema.usuario.id });
  await db.insert(schema.profissional).values({ usuarioId: u.id, cpf: `7${String(Date.now()).slice(-7)}${String(n).padStart(3, '0')}`, profissao: 'psicologo', conselho: 'CRP', registroNumero: String(n), registroUf: 'SP', status: 'aprovado' });
  return { id: u.id, email };
}
const entrar = (email: string) => auth.api.signInEmail({ body: { email, password: SENHA }, returnHeaders: true });
const cookieDe = (h: Headers) => h.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const sessoes = (id: string) => db.select().from(schema.sessao).where(eq(schema.sessao.userId, id));

describe('contaAtiva', () => {
  it('só um false explícito tira o acesso; conta ausente também não entra', () => {
    expect(contaAtiva({ ativo: true })).toBe(true);
    expect(contaAtiva({})).toBe(true);
    expect(contaAtiva({ ativo: null })).toBe(true);
    expect(contaAtiva({ ativo: false })).toBe(false);
    expect(contaAtiva(null)).toBe(false);
    expect(contaAtiva(undefined)).toBe(false);
  });
});

describe('desativar o acesso', () => {
  it('derruba as sessões abertas, recusa um login novo e volta a entrar depois de reativar', async () => {
    const anf = await f.anfitriao();
    const p = await profissionalComLogin();

    const { headers } = await entrar(p.email);
    expect(await auth.api.getSession({ headers: new Headers({ cookie: cookieDe(headers) }) })).not.toBeNull();
    expect(await sessoes(p.id)).toHaveLength(1);

    await desativarAcesso(p.id, anf, 'Pedido do próprio profissional', '203.0.113.9');

    expect(await sessoes(p.id)).toHaveLength(0);
    expect(await auth.api.getSession({ headers: new Headers({ cookie: cookieDe(headers) }) })).toBeNull();
    await expect(entrar(p.email)).rejects.toMatchObject({ body: { code: 'CONTA_DESATIVADA' }, statusCode: 403 });
    expect(await sessoes(p.id)).toHaveLength(0); // a tentativa não deixou sessão

    await reativarAcesso(p.id, anf);
    const { headers: novos } = await entrar(p.email);
    expect(await auth.api.getSession({ headers: new Headers({ cookie: cookieDe(novos) }) })).not.toBeNull();
  });

  it('senha errada continua dando o erro de sempre, sem revelar que a conta está desativada', async () => {
    const anf = await f.anfitriao();
    const p = await profissionalComLogin();
    await desativarAcesso(p.id, anf, null);
    await expect(auth.api.signInEmail({ body: { email: p.email, password: 'senha-errada-123' } })).rejects.toMatchObject({ body: { code: 'INVALID_EMAIL_OR_PASSWORD' } });
  });

  it('audita quem fez, o motivo e o IP, nos dois sentidos', async () => {
    const anf = await f.anfitriao();
    const p = await profissionalComLogin();
    await desativarAcesso(p.id, anf, 'Motivo X', '203.0.113.9');
    await reativarAcesso(p.id, anf, '203.0.113.9');

    const eventos = await db.select().from(schema.eventoAuditoria).where(and(eq(schema.eventoAuditoria.entidade, 'profissional'), eq(schema.eventoAuditoria.entidadeId, p.id)));
    expect(eventos.map((e) => e.acao).sort()).toEqual(['acesso_desativado', 'acesso_reativado']);
    expect(eventos.find((e) => e.acao === 'acesso_desativado')).toMatchObject({ usuarioId: anf, ip: '203.0.113.9', dados: { motivo: 'Motivo X' } });
  });

  it('recusa quando já está no estado pedido, no próprio acesso e em quem não é profissional', async () => {
    const anf = await f.anfitriao();
    const outro = await f.anfitriao();
    const p = await profissionalComLogin();

    await expect(reativarAcesso(p.id, anf)).rejects.toMatchObject({ motivo: 'estado' });
    await desativarAcesso(p.id, anf, null);
    await expect(desativarAcesso(p.id, anf, null)).rejects.toMatchObject({ motivo: 'estado' });
    await expect(desativarAcesso(p.id, p.id, null)).rejects.toBeInstanceOf(AcessoInvalidoError);
    await expect(desativarAcesso(p.id, p.id, null)).rejects.toMatchObject({ motivo: 'proprio' });
    // um Anfitrião nunca é desativado por aqui
    await expect(desativarAcesso(outro, anf, null)).rejects.toMatchObject({ motivo: 'nao_encontrado' });
    const [u] = await db.select({ ativo: schema.usuario.ativo }).from(schema.usuario).where(eq(schema.usuario.id, outro));
    expect(u.ativo).toBe(true);
  });
});
