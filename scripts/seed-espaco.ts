import 'dotenv/config';
import { pool } from '../src/db';
import { garantirEspacoInicial } from '../src/modulos/configuracao/espaco-inicial';

// Uso: npm run seed:espaco  (idempotente; roda também no deploy)
garantirEspacoInicial()
  .then((r) => console.log(r.criado ? `Sala criada (${r.espacoId}).` : `Sala já existia (${r.espacoId}).`))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
