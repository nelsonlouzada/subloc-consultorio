import { randomUUID } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool, schema } from '@/db';

const enviarEmail = vi.fn<(para: string, assunto: string, html: string) => Promise<void>>();
vi.mock('@/lib/email', () => ({ enviarEmail: (...a: [string, string, string]) => enviarEmail(...a) }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

import { emailConfirmarEndereco, emailRedefinirSenha } from '@/modulos/comunicacao/modelos';
import { auth } from './auth';
import { DESTINO_APOS_CONFIRMAR, urlDeConfirmacao } from './confirmacao';

const prefixo = `teste-auth-${randomUUID().slice(0, 8)}`;
const SENHA = 'senha-de-teste-123';

beforeEach(() => {
  enviarEmail.mockReset();
  enviarEmail.mockResolvedValue(undefined);
});

afterAll(async () => {
  await db.delete(schema.usuario).where(like(schema.usuario.email, `${prefixo}%`));
  await pool.end();
});

async function novaConta(n: string) {
  const email = `${prefixo}-${n}@example.com`;
  await auth.api.signUpEmail({ body: { email, name: 'Fulana de Teste', password: SENHA } });
  await vi.waitFor(() => expect(enviarEmail).toHaveBeenCalled()); // o envio no cadastro roda em segundo plano
  return email;
}
const links = () => enviarEmail.mock.calls.map((c) => c[2].match(/href="([^"]+verify-email[^"]+)"/)?.[1]).filter(Boolean) as string[];

describe('urlDeConfirmacao', () => {
  it('troca o destino mantendo o token', () => {
    const url = urlDeConfirmacao('https://exemplo.test/api/auth/verify-email?token=abc.def&callbackURL=%2F');
    const u = new URL(url);
    expect(u.searchParams.get('token')).toBe('abc.def');
    expect(u.searchParams.get('callbackURL')).toBe(DESTINO_APOS_CONFIRMAR);
  });

  it('acrescenta o destino quando o link não tinha', () => {
    expect(new URL(urlDeConfirmacao('https://exemplo.test/api/auth/verify-email?token=x')).searchParams.get('callbackURL')).toBe(DESTINO_APOS_CONFIRMAR);
  });
});

describe('modelos de e-mail da conta', () => {
  it('escapam o nome e o link, e trazem o botão e a validade', () => {
    const m = emailConfirmarEndereco({ nome: '<b>Ana</b>', url: 'https://x.test/a?b=1&c="2"' });
    expect(m.assunto).toBe('Confirme seu e-mail');
    expect(m.html).toContain('&lt;b&gt;Ana&lt;/b&gt;');
    expect(m.html).not.toContain('<b>Ana</b>');
    expect(m.html).toContain('href="https://x.test/a?b=1&amp;c=&quot;2&quot;"');
    expect(m.html).toContain('1 hora');

    const r = emailRedefinirSenha({ nome: 'Ana', url: 'https://x.test/r' });
    expect(r.assunto).toBe('Criar nova senha');
    expect(r.html).toContain('href="https://x.test/r"');
  });
});

describe('confirmação do e-mail pela biblioteca de login', () => {
  it('o e-mail do cadastro leva ao login com o aviso, e vem no modelo padronizado', async () => {
    const email = await novaConta('a');
    const [assunto, html] = [enviarEmail.mock.calls[0][1], enviarEmail.mock.calls[0][2]];
    expect(assunto).toBe('Confirme seu e-mail');
    expect(html).toContain('Fulana de Teste');
    const link = new URL(links()[0].replace(/&amp;/g, '&'));
    expect(link.searchParams.get('callbackURL')).toBe(DESTINO_APOS_CONFIRMAR);
    expect(enviarEmail.mock.calls[0][0]).toBe(email);
  });

  it('tentar entrar sem confirmar (senha certa) reenvia o link; senha errada não envia nada', async () => {
    const email = await novaConta('b');
    enviarEmail.mockClear();

    await expect(auth.api.signInEmail({ body: { email, password: 'senha-errada-999' } })).rejects.toMatchObject({ body: { code: 'INVALID_EMAIL_OR_PASSWORD' } });
    await new Promise((r) => setTimeout(r, 300));
    expect(enviarEmail).not.toHaveBeenCalled();

    await expect(auth.api.signInEmail({ body: { email, password: SENHA } })).rejects.toMatchObject({ body: { code: 'EMAIL_NOT_VERIFIED' } });
    await vi.waitFor(() => expect(enviarEmail).toHaveBeenCalledTimes(1));
    expect(enviarEmail.mock.calls[0][0]).toBe(email);
    expect(new URL(links()[0].replace(/&amp;/g, '&')).searchParams.get('callbackURL')).toBe(DESTINO_APOS_CONFIRMAR);
  });

  it('o link reenviado confirma a conta, e depois dele a pessoa consegue entrar', async () => {
    const email = await novaConta('c');
    enviarEmail.mockClear();
    await expect(auth.api.signInEmail({ body: { email, password: SENHA } })).rejects.toBeTruthy();
    await vi.waitFor(() => expect(links().length).toBe(1));

    const token = new URL(links()[0].replace(/&amp;/g, '&')).searchParams.get('token')!;
    await auth.api.verifyEmail({ query: { token } });
    const [u] = await db.select().from(schema.usuario).where(eq(schema.usuario.email, email));
    expect(u.emailVerified).toBe(true);
    await expect(auth.api.signInEmail({ body: { email, password: SENHA } })).resolves.toBeTruthy();
  });

  it('o e-mail de redefinição de senha usa o modelo padronizado', async () => {
    const email = await novaConta('d');
    enviarEmail.mockClear();
    await auth.api.requestPasswordReset({ body: { email, redirectTo: '/redefinir-senha' } });
    await vi.waitFor(() => expect(enviarEmail).toHaveBeenCalledTimes(1));
    expect(enviarEmail.mock.calls[0][1]).toBe('Criar nova senha');
    expect(enviarEmail.mock.calls[0][2]).toContain('Fulana de Teste');
    expect(enviarEmail.mock.calls[0][2]).toContain('/api/auth/reset-password/');
  });
});
