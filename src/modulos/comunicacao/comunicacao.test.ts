import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool, schema } from '@/db';

// Troca só o envio real; o registro em `notificacao` roda no Postgres de verdade.
const enviarEmail = vi.fn<(para: string, assunto: string, html: string) => Promise<void>>();
vi.mock('@/lib/email', () => ({ enviarEmail: (...a: [string, string, string]) => enviarEmail(...a) }));
vi.mock('@sentry/node', () => ({ captureException: vi.fn() }));

import { emailCadastroRecusado, emailNovoCadastro, esc } from './modelos';
import { notificar } from './notificar';

const usuarioId = `teste-notif-${randomUUID()}`;

const aviso = (referenciaId: string, tipo = 'cadastro_aprovado') => ({
  usuarioId,
  para: 'alguem@example.com',
  tipo,
  assunto: 'Assunto',
  html: '<p>oi</p>',
  referenciaTipo: 'profissional',
  referenciaId,
});

const registros = () => db.select().from(schema.notificacao).where(eq(schema.notificacao.usuarioId, usuarioId));

beforeAll(async () => {
  await db.insert(schema.usuario).values({ id: usuarioId, name: 'Teste Notif', email: `${usuarioId}@example.com` });
});

beforeEach(() => {
  enviarEmail.mockReset();
  enviarEmail.mockResolvedValue(undefined);
});

afterAll(async () => {
  await db.delete(schema.usuario).where(eq(schema.usuario.id, usuarioId)); // notificacao sai em cascata
  await pool.end();
});

describe('notificar', () => {
  it('envia e registra como enviado', async () => {
    const ref = randomUUID();
    expect(await notificar(aviso(ref))).toBe('enviado');
    expect(enviarEmail).toHaveBeenCalledOnce();
    const r = (await registros()).find((x) => x.referenciaId === ref);
    expect(r).toMatchObject({ status: 'enviado', tipo: 'cadastro_aprovado', canal: 'email', erro: null });
  });

  it('o mesmo aviso não sai duas vezes', async () => {
    const ref = randomUUID();
    await notificar(aviso(ref));
    expect(await notificar(aviso(ref))).toBe('duplicado');
    expect(enviarEmail).toHaveBeenCalledOnce();
    expect((await registros()).filter((x) => x.referenciaId === ref)).toHaveLength(1);
  });

  it('tipos diferentes para a mesma referência saem separados', async () => {
    const ref = randomUUID();
    await notificar(aviso(ref, 'cadastro_aprovado'));
    await notificar(aviso(ref, 'cadastro_recusado'));
    expect(enviarEmail).toHaveBeenCalledTimes(2);
  });

  it('falha de envio fica registrada e não derruba quem chamou', async () => {
    const ref = randomUUID();
    enviarEmail.mockRejectedValueOnce(new Error('Resend fora do ar'));
    expect(await notificar(aviso(ref))).toBe('falhou');
    const r = (await registros()).find((x) => x.referenciaId === ref);
    expect(r).toMatchObject({ status: 'falhou', erro: 'Resend fora do ar' });
  });

  it('aviso que falhou pode ser tentado de novo e vira enviado, sem duplicar a linha', async () => {
    const ref = randomUUID();
    enviarEmail.mockRejectedValueOnce(new Error('instável'));
    await notificar(aviso(ref));
    expect(await notificar(aviso(ref))).toBe('enviado');
    const linhas = (await registros()).filter((x) => x.referenciaId === ref);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ status: 'enviado', erro: null });
  });
});

describe('modelos de e-mail', () => {
  it('escapa HTML vindo de usuário', () => {
    expect(esc(`<script>alert("x")</script> & 'a'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;a&#39;',
    );
  });

  it('o nome do cadastro não injeta HTML no e-mail aos Anfitriões', () => {
    const { html, assunto } = emailNovoCadastro({
      nome: '<img src=x onerror=alert(1)>',
      profissao: 'psicólogo',
      conselho: 'CRP',
      registro: '123',
      uf: 'SP',
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(assunto).toContain('<img'); // assunto é texto puro, não HTML
  });

  it('o motivo da recusa também é escapado', () => {
    expect(emailCadastroRecusado('Ana', '<b>x</b>').html).not.toContain('<b>x</b>');
  });
});
