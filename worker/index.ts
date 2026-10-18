import 'dotenv/config';
import { PgBoss } from 'pg-boss';

// Processo sempre ligado que roda os jobs (prazos, lembretes, vencimentos).
// Na E0 só existe o job de teste, para provar que a fila funciona em produção.
const FILA_TESTE = 'teste-batimento';

async function main() {
  const boss = new PgBoss(process.env.DATABASE_URL!);
  boss.on('error', (e) => console.error('[pg-boss]', e));
  await boss.start();

  await boss.createQueue(FILA_TESTE);
  await boss.work(FILA_TESTE, async () => {
    console.log(`[worker] batimento ${new Date().toISOString()}`);
  });
  await boss.schedule(FILA_TESTE, '*/5 * * * *');

  console.log('[worker] no ar');
  const parar = async () => {
    await boss.stop();
    process.exit(0);
  };
  process.on('SIGTERM', parar);
  process.on('SIGINT', parar);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
