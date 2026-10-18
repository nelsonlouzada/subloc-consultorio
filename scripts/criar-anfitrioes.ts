import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { auth } from '../src/lib/auth';
import { db, pool, schema } from '../src/db';

// Cria (ou promove) as duas contas de Anfitrião (D7). Pode rodar de novo sem duplicar.
async function criar(n: number) {
  const email = process.env[`ANFITRIAO_${n}_EMAIL`];
  const nome = process.env[`ANFITRIAO_${n}_NOME`];
  const senha = process.env[`ANFITRIAO_${n}_SENHA`];
  if (!email || !nome || !senha) throw new Error(`Defina ANFITRIAO_${n}_EMAIL, _NOME e _SENHA.`);

  const [existente] = await db.select().from(schema.usuario).where(eq(schema.usuario.email, email));
  if (!existente) await auth.api.signUpEmail({ body: { email, name: nome, password: senha } });

  await db
    .update(schema.usuario)
    .set({ papel: 'anfitriao', emailVerified: true })
    .where(eq(schema.usuario.email, email));
  console.log(`${existente ? 'Promovido' : 'Criado'}: ${email}`);
}

async function main() {
  await criar(1);
  await criar(2);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
