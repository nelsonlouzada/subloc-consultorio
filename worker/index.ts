import 'dotenv/config';
import * as Sentry from '@sentry/node';
import { PgBoss } from 'pg-boss';
import { expirarPrazos } from '../src/modulos/agenda/expiracao';

Sentry.init({
  dsn: process.env.SENTRY_DSN_WORKER,
  environment: process.env.NODE_ENV,
  enabled: Boolean(process.env.SENTRY_DSN_WORKER),
});

// Processo sempre ligado que roda os jobs (prazos, lembretes, vencimentos).
// Na E0 só existe o job de teste, para provar que a fila funciona em produção.
const FILA_TESTE = 'teste-batimento';
const FILA_EXPIRAR = 'expirar-prazos';

async function main() {
  const boss = new PgBoss(process.env.DATABASE_URL!);
  boss.on('error', (e) => {
    console.error('[pg-boss]', e);
    Sentry.captureException(e);
  });
  await boss.start();

  await boss.createQueue(FILA_TESTE);
  await boss.work(FILA_TESTE, async () => {
    console.log(`[worker] batimento ${new Date().toISOString()}`);
  });
  await boss.schedule(FILA_TESTE, '*/5 * * * *');

  // Expira pedidos sem aprovação e aprovações sem pagamento (D3) e libera os horários. Roda a cada
  // minuto: o prazo vale até o minuto seguinte, e a aprovação já é recusada depois do prazo.
  await boss.createQueue(FILA_EXPIRAR);
  await boss.work(FILA_EXPIRAR, async () => {
    try {
      const r = await expirarPrazos();
      if (r.aprovacao || r.pagamento) console.log(`[worker] expirou ${r.aprovacao} sem aprovação, ${r.pagamento} sem pagamento`);
    } catch (e) {
      Sentry.captureException(e);
      throw e; // o pg-boss registra a falha e tenta de novo
    }
  });
  await boss.schedule(FILA_EXPIRAR, '* * * * *');

  console.log('[worker] no ar');
  const parar = async () => {
    await boss.stop();
    process.exit(0);
  };
  process.on('SIGTERM', parar);
  process.on('SIGINT', parar);
}

main().catch(async (e) => {
  console.error(e);
  Sentry.captureException(e);
  await Sentry.flush(2000);
  process.exit(1);
});
