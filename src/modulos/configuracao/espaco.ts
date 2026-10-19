import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { SLUG_SALA } from './espaco-inicial';

/** A sala e suas regras. Hoje só existe uma sala (visao.md, seção 2). */
export async function carregarSala() {
  const [linha] = await db
    .select({ espaco: schema.espaco, regras: schema.regraEspaco })
    .from(schema.espaco)
    .innerJoin(schema.regraEspaco, eq(schema.regraEspaco.espacoId, schema.espaco.id))
    .where(eq(schema.espaco.slug, SLUG_SALA));
  return linha ?? null;
}

/** '07:00:00' -> 7 */
export const horaInteira = (tempo: string) => Number(tempo.slice(0, 2));
