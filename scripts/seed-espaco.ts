import 'dotenv/config';
import { pool } from '../src/db';
import { garantirDocumentosIniciais } from '../src/modulos/configuracao/documentos-iniciais';
import { garantirEspacoInicial } from '../src/modulos/configuracao/espaco-inicial';

// Uso: npm run seed:espaco  (idempotente; roda também no deploy, via deploy:preparar)
async function main() {
  const sala = await garantirEspacoInicial();
  console.log(sala.criado ? `Sala criada (${sala.espacoId}).` : `Sala já existia (${sala.espacoId}).`);
  const docs = await garantirDocumentosIniciais();
  console.log(docs.criados.length ? `Documentos publicados: ${docs.criados.join(', ')}.` : 'Documentos já publicados.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
