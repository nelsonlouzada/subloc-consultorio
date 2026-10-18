import * as Sentry from '@sentry/nextjs';

// Sem DSN (desenvolvimento local), o Sentry fica desligado.
// Dados pessoais (CPF, registro profissional) nunca devem ir para o Sentry: não anexar usuário nem corpo de requisição aos eventos.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  Sentry.init({
    dsn: process.env.SENTRY_DSN_WEB,
    environment: process.env.NODE_ENV,
    enabled: Boolean(process.env.SENTRY_DSN_WEB),
    tracesSampleRate: 0,
  });
}

export const onRequestError = Sentry.captureRequestError;
