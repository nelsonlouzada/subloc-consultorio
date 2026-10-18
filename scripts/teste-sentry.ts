import 'dotenv/config';
import * as Sentry from '@sentry/node';

// Uso: npm run teste:sentry  (envia um erro de teste ao projeto do worker)
Sentry.init({ dsn: process.env.SENTRY_DSN_WORKER, environment: 'teste' });
Sentry.captureException(new Error('Teste do Sentry (worker) - pode ignorar'));
Sentry.flush(5000).then((ok) => {
  console.log(ok ? 'Evento enviado ao Sentry.' : 'Nao foi possivel confirmar o envio.');
  process.exit(ok ? 0 : 1);
});
