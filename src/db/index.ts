import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const globalParaPool = globalThis as unknown as { pool?: Pool };

export const pool =
  globalParaPool.pool ?? new Pool({ connectionString: process.env.DATABASE_URL });
if (process.env.NODE_ENV !== 'production') globalParaPool.pool = pool;

export const db = drizzle(pool, { schema });
export { schema };
