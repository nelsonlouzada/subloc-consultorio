import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { urlDeConfirmacao } from './confirmacao';
import { enviarEmail } from './email';
import { emailConfirmarEndereco, emailRedefinirSenha } from '@/modulos/comunicacao/modelos';

export const auth = betterAuth({
  hooks: {
    // A rota pública de cadastro da biblioteca fica fechada: ela criaria contas sem CPF, registro no conselho nem aceite
    // do contrato. Contas nascem só em `cadastrarProfissional` e no script dos Anfitriões, que chamam a API por dentro
    // do servidor (sem requisição HTTP, então `ctx.request` não existe).
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/sign-up/email' && ctx.request) {
        throw new APIError('FORBIDDEN', { message: 'O cadastro é feito pelo formulário do sistema.', code: 'CADASTRO_PELO_FORMULARIO' });
      }
    }),
  },
  databaseHooks: {
    session: {
      create: {
        // Conta desativada não abre sessão nova, por nenhum caminho de login. A senha já foi conferida
        // quando este ponto roda, então a mensagem não revela nada a quem erra a senha.
        before: async (sessao) => {
          const [u] = await db.select({ ativo: schema.usuario.ativo }).from(schema.usuario).where(eq(schema.usuario.id, String(sessao.userId)));
          if (u && !u.ativo) throw new APIError('FORBIDDEN', { message: 'Esta conta está desativada.', code: 'CONTA_DESATIVADA' });
        },
      },
    },
  },
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.usuario,
      session: schema.sessao,
      account: schema.conta,
      verification: schema.verificacao,
    },
  }),
  user: {
    additionalFields: {
      // Nunca vem do formulário: o papel de Anfitrião é dado só pelo script de criação.
      papel: { type: 'string', defaultValue: 'profissional', input: false },
      telefone: { type: 'string', required: false },
      ativo: { type: 'boolean', defaultValue: true, input: false },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 10,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      const m = emailRedefinirSenha({ nome: user.name, url });
      await enviarEmail(user.email, m.assunto, m.html);
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    // Quem tenta entrar sem ter confirmado (com a senha certa) recebe um link novo: o primeiro vale 1 hora.
    sendOnSignIn: true,
    sendVerificationEmail: async ({ user, url }) => {
      const m = emailConfirmarEndereco({ nome: user.name, url: urlDeConfirmacao(url) });
      await enviarEmail(user.email, m.assunto, m.html);
    },
  },
});
