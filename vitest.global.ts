import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { urlDeTeste } from './vitest.banco';

/** Cria o banco de teste se faltar e aplica as migrações, antes de qualquer teste. */
export default async function preparar() {
  const alvo = new URL(urlDeTeste());
  const nome = decodeURIComponent(alvo.pathname.slice(1));

  const admin = new URL(alvo);
  admin.pathname = '/postgres';
  const conexao = new Pool({ connectionString: admin.toString() });
  try {
    const { rowCount } = await conexao.query('select 1 from pg_database where datname = $1', [nome]);
    if (!rowCount) await conexao.query(`create database "${nome.replaceAll('"', '""')}"`);
  } catch (e) {
    // Sem permissão para criar (banco gerenciado, CI): segue, o banco já deve existir.
    if (!(await existe(alvo))) throw e;
  } finally {
    await conexao.end();
  }

  const pool = new Pool({ connectionString: alvo.toString() });
  try {
    await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  } finally {
    await pool.end();
  }
}

async function existe(url: URL): Promise<boolean> {
  const pool = new Pool({ connectionString: url.toString() });
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}
