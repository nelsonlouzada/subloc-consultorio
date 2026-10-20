import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db, schema } from '@/db';
import { enviarEmail } from './email';

export const auth = betterAuth({
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
      await enviarEmail(
        user.email,
        'Criar nova senha',
        `<p>Recebemos um pedido para criar uma nova senha. <a href="${url}">Clique aqui para criá-la</a>. O link vale por 1 hora.</p><p>Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>`,
      );
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      await enviarEmail(user.email, 'Confirme seu e-mail', `<p>Para confirmar o e-mail, <a href="${url}">clique aqui</a>.</p>`);
    },
  },
});
