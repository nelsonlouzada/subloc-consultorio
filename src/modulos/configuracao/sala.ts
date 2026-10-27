import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/db';

/** Dados da sala que aparecem na página pública (T01). Fotos entram junto com a página pública. */

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

/** Texto opcional: espaços nas pontas saem e vazio vira nulo. */
const opcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((t) => t || null);

export const esquemaSala = z.object({
  nome: z.string().trim().min(1, 'nome').max(80, 'nome'),
  descricao: opcional(1000),
  logradouro: opcional(120),
  numero: opcional(20),
  complemento: opcional(60),
  bairro: opcional(60),
  cidade: opcional(60),
  uf: z
    .string()
    .trim()
    .toUpperCase()
    .transform((u) => u || null)
    .refine((u) => u === null || UFS.includes(u), 'uf'),
  cep: z
    .string()
    .transform((c) => c.replace(/\D/g, ''))
    .refine((c) => c === '' || c.length === 8, 'cep')
    .transform((c) => (c ? `${c.slice(0, 5)}-${c.slice(5)}` : null)),
  // Uma comodidade por linha; repetidas e vazias saem.
  comodidades: z
    .string()
    .transform((t) => [...new Set(t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))])
    .refine((l) => l.length <= 20 && l.every((c) => c.length <= 40), 'comodidades'),
});

export type DadosSala = z.output<typeof esquemaSala>;

export const TEXTO_ERRO_SALA: Record<string, string> = {
  nome: 'A sala precisa de um nome (até 80 letras).',
  uf: 'Use a sigla do estado, como SP.',
  cep: 'O CEP tem 8 números.',
  comodidades: 'Até 20 comodidades, uma por linha, com até 40 letras cada.',
  invalido: 'Confira os campos: algum texto passou do tamanho permitido.',
};

export function lerSala(entrada: unknown): { ok: true; dados: DadosSala } | { ok: false; erro: string } {
  const r = esquemaSala.safeParse(entrada);
  if (r.success) return { ok: true, dados: r.data };
  const msg = r.error.issues[0]?.message;
  return { ok: false, erro: msg && msg in TEXTO_ERRO_SALA ? msg : 'invalido' };
}

export function salaParaTela(e: typeof schema.espaco.$inferSelect): DadosSala {
  return {
    nome: e.nome,
    descricao: e.descricao,
    logradouro: e.logradouro,
    numero: e.numero,
    complemento: e.complemento,
    bairro: e.bairro,
    cidade: e.cidade,
    uf: e.uf,
    cep: e.cep,
    comodidades: e.comodidades,
  };
}

/** Grava os dados da sala e audita só o que mudou (antes e depois). */
export async function salvarSala(espacoId: string, usuarioId: string, dados: DadosSala, ip?: string | null) {
  return db.transaction(async (tx) => {
    const [atual] = await tx.select().from(schema.espaco).where(eq(schema.espaco.id, espacoId));
    if (!atual) throw new Error('Sala não encontrada.');

    const antes = salaParaTela(atual) as Record<string, unknown>;
    const depois = dados as Record<string, unknown>;
    const mudou = Object.keys(depois).filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(depois[k]));
    if (mudou.length === 0) return { mudou: [] as string[] };

    await tx.update(schema.espaco).set(dados).where(eq(schema.espaco.id, espacoId));
    await tx.insert(schema.eventoAuditoria).values({
      usuarioId,
      acao: 'sala_alterada',
      entidade: 'espaco',
      entidadeId: espacoId,
      dados: { antes: Object.fromEntries(mudou.map((k) => [k, antes[k]])), depois: Object.fromEntries(mudou.map((k) => [k, depois[k]])) },
      ip: ip ?? null,
    });
    return { mudou };
  });
}
