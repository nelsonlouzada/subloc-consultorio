import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, pool, schema } from '@/db';

const enviarEmail = vi.fn<(para: string, assunto: string, html: string) => Promise<void>>();
vi.mock('@/lib/email', () => ({ enviarEmail: (...a: [string, string, string]) => enviarEmail(...a) }));
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import { garantirDocumentosIniciais } from '@/modulos/configuracao/documentos-iniciais';
import { cadastrarProfissional, esquemaCadastro } from './cadastro';

const base = {
  nome: 'Ana Souza Teste',
  email: 'ana@example.com',
  telefone: '(11) 91234-5678',
  cpf: '529.982.247-25',
  profissao: 'psicologo',
  conselho: 'CRP',
  registroNumero: '06/12345',
  registroUf: 'SP',
  senha: 'uma-senha-longa-1',
  confirmarSenha: 'uma-senha-longa-1',
  aceiteContrato: 'on',
};

describe('validação do cadastro', () => {
  it('aceita dados corretos e normaliza e-mail, telefone e CPF', () => {
    const r = esquemaCadastro.safeParse({ ...base, email: '  ANA@Example.com ' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.email).toBe('ana@example.com');
      expect(r.data.telefone).toBe('11912345678');
      expect(r.data.cpf).toBe('52998224725');
    }
  });

  it.each([
    ['CPF inválido', { cpf: '111.111.111-11' }],
    ['e-mail inválido', { email: 'sem-arroba' }],
    ['nome curto', { nome: 'Ana' }],
    ['telefone sem DDD', { telefone: '91234-5678' }],
    ['senha curta', { senha: 'curta', confirmarSenha: 'curta' }],
    ['senhas diferentes', { confirmarSenha: 'outra-senha-longa' }],
    ['sem aceite do contrato', { aceiteContrato: '' }],
    ['UF inexistente', { registroUf: 'XX' }],
    ['profissão desconhecida', { profissao: 'astronauta' }],
  ])('recusa %s', (_nome, mudanca) => {
    expect(esquemaCadastro.safeParse({ ...base, ...mudanca }).success).toBe(false);
  });
});

describe('cadastrarProfissional', () => {
  const sufixo = randomUUID().slice(0, 8);
  const emails: string[] = [];
  let anfitriaoId: string;
  const emailAnfitriao = `anf-${sufixo}@example.com`;

  // CPFs válidos distintos por teste (a coluna é única).
  const cpfs = ['529.982.247-25', '111.444.777-35', '168.995.350-09', '935.411.347-80'];
  let contador = 0;
  const dadosDe = (i: number, extra = {}) => {
    const email = `cad-${sufixo}-${++contador}@example.com`; // sempre um e-mail novo
    emails.push(email);
    return esquemaCadastro.parse({ ...base, email, cpf: cpfs[i], ...extra });
  };
  const ctx = { ip: '203.0.113.9', userAgent: 'vitest' };

  beforeAll(async () => {
    await garantirDocumentosIniciais();
    anfitriaoId = `teste-anf-${sufixo}`;
    await db.insert(schema.usuario).values({ id: anfitriaoId, name: 'Anfitrião Teste', email: emailAnfitriao, papel: 'anfitriao' });
    emails.push(emailAnfitriao);
  });

  beforeEach(() => {
    enviarEmail.mockReset();
    enviarEmail.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    const usuarios = await db.select({ id: schema.usuario.id }).from(schema.usuario).where(inArray(schema.usuario.email, emails));
    const ids = usuarios.map((u) => u.id);
    if (ids.length) {
      await db.delete(schema.notificacao).where(inArray(schema.notificacao.referenciaId, ids));
      await db.delete(schema.aceite).where(inArray(schema.aceite.usuarioId, ids));
      await db.delete(schema.eventoAuditoria).where(inArray(schema.eventoAuditoria.usuarioId, ids));
      await db.delete(schema.usuario).where(inArray(schema.usuario.id, ids)); // profissional sai em cascata
    }
    await pool.end();
  });

  it('cria conta, cadastro pendente, aceite com IP e versão, e avisa os Anfitriões', async () => {
    const dados = dadosDe(0);
    const r = await cadastrarProfissional(dados, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const [prof] = await db.select().from(schema.profissional).where(eq(schema.profissional.usuarioId, r.profissionalId));
    expect(prof).toMatchObject({ status: 'pendente', cpf: '52998224725', conselho: 'CRP', registroUf: 'SP' });

    const [user] = await db.select().from(schema.usuario).where(eq(schema.usuario.id, r.profissionalId));
    expect(user).toMatchObject({ papel: 'profissional', emailVerified: false, telefone: '11912345678' });

    const [ac] = await db.select().from(schema.aceite).where(eq(schema.aceite.usuarioId, r.profissionalId));
    expect(ac).toMatchObject({ ip: '203.0.113.9', userAgent: 'vitest' });
    const [doc] = await db.select().from(schema.documentoLegal).where(eq(schema.documentoLegal.id, ac.documentoId));
    expect(doc).toMatchObject({ tipo: 'contrato', versao: 1 });

    const destinatarios = enviarEmail.mock.calls.map((c) => c[0]);
    expect(destinatarios).toContain(emailAnfitriao); // aviso ao Anfitrião
    expect(destinatarios).toContain(dados.email); // verificação de e-mail ao próprio Profissional
  });

  it('não grava a senha em texto e não deixa o Profissional entrar sem confirmar o e-mail', async () => {
    const dados = dadosDe(1);
    const r = await cadastrarProfissional(dados, ctx);
    expect(r.ok).toBe(true);
    const [conta] = await db.select().from(schema.conta).where(eq(schema.conta.accountId, (r as { profissionalId: string }).profissionalId));
    expect(conta.password).toBeTruthy();
    expect(conta.password).not.toContain(dados.senha);
  });

  it('recusa CPF já cadastrado, sem criar conta', async () => {
    await cadastrarProfissional(dadosDe(2), ctx);
    const outro = dadosDe(2); // mesmo CPF, outro e-mail
    const r = await cadastrarProfissional(outro, ctx);
    expect(r).toEqual({ ok: false, erro: 'cpf_em_uso' });
    const achou = await db.select().from(schema.usuario).where(eq(schema.usuario.email, outro.email));
    expect(achou).toHaveLength(0);
  });

  it('recusa e-mail já cadastrado', async () => {
    const dados = dadosDe(3);
    await cadastrarProfissional(dados, ctx);
    const r = await cadastrarProfissional({ ...dados, cpf: '28625587887' }, ctx);
    expect(r).toEqual({ ok: false, erro: 'email_em_uso' });
  });

  it('falha de e-mail não impede o cadastro', async () => {
    enviarEmail.mockRejectedValue(new Error('Resend fora do ar'));
    const r = await cadastrarProfissional(dadosDe(0, { cpf: '286.255.878-87' }), ctx);
    expect(r.ok).toBe(true);
  });
});
