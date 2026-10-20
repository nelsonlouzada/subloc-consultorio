import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';
import { db, schema } from '@/db';

const DIA_MS = 86_400_000;

// Aceita o `db` ou uma transação, para o crédito nascer na mesma transação de quem o gerou.
type Banco = Pick<typeof db, 'select' | 'insert' | 'update'>;
type Origem = (typeof schema.creditoLote.origem.enumValues)[number];

async function validadeDiasDoEspaco(banco: Banco, espacoId: string): Promise<number> {
  const [regra] = await banco
    .select({ dias: schema.regraEspaco.validadeCreditoDias })
    .from(schema.regraEspaco)
    .where(eq(schema.regraEspaco.espacoId, espacoId));
  return regra?.dias ?? 90;
}

/** Cria um lote de crédito com a validade configurada na sala (padrão: 90 dias). */
export async function concederCredito(
  banco: Banco,
  p: {
    profissionalId: string;
    espacoId: string;
    origem: Origem;
    valorCentavos: number;
    reservaId?: string;
    cobrancaId?: string;
    criadoPor?: string | null;
  },
  agora = new Date(),
) {
  if (!Number.isInteger(p.valorCentavos) || p.valorCentavos <= 0) throw new RangeError('O valor do crédito deve ser positivo, em centavos.');
  const dias = await validadeDiasDoEspaco(banco, p.espacoId);
  const [lote] = await banco
    .insert(schema.creditoLote)
    .values({
      profissionalId: p.profissionalId,
      origem: p.origem,
      valorInicialCentavos: p.valorCentavos,
      saldoCentavos: p.valorCentavos,
      validadeAte: new Date(agora.getTime() + dias * DIA_MS),
      reservaId: p.reservaId ?? null,
      cobrancaId: p.cobrancaId ?? null,
      criadoPor: p.criadoPor ?? null,
    })
    .returning();
  await banco.insert(schema.creditoMovimento).values({
    loteId: lote.id,
    tipo: 'entrada',
    valorCentavos: p.valorCentavos,
    reservaId: p.reservaId ?? null,
    cobrancaId: p.cobrancaId ?? null,
    criadoPor: p.criadoPor ?? null,
  });
  return lote;
}

/** Saldo = soma dos lotes ainda válidos. Só leitura: o vencimento em si é gravado por `vencerLotes`. */
export async function saldoDisponivel(profissionalId: string, agora = new Date()): Promise<number> {
  const [linha] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.creditoLote.saldoCentavos}), 0)::int` })
    .from(schema.creditoLote)
    .where(and(eq(schema.creditoLote.profissionalId, profissionalId), gt(schema.creditoLote.validadeAte, agora)));
  return linha.total;
}

/**
 * Consome crédito do que vence primeiro (D8), gravando um movimento por lote tocado. Roda numa
 * transação: trava os lotes do Profissional (FOR UPDATE), então dois usos ao mesmo tempo nunca
 * gastam o mesmo saldo duas vezes. Devolve o que de fato foi usado (até `ate`).
 */
export async function usarCredito(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  p: { profissionalId: string; ate: number; reservaId?: string; cobrancaId?: string },
  agora = new Date(),
): Promise<number> {
  if (!Number.isInteger(p.ate) || p.ate <= 0) return 0;
  const lotes = await tx
    .select()
    .from(schema.creditoLote)
    .where(and(eq(schema.creditoLote.profissionalId, p.profissionalId), gt(schema.creditoLote.validadeAte, agora), gt(schema.creditoLote.saldoCentavos, 0)))
    .orderBy(asc(schema.creditoLote.validadeAte), asc(schema.creditoLote.criadoEm))
    .for('update');

  let falta = p.ate;
  for (const lote of lotes) {
    if (falta === 0) break;
    const usar = Math.min(lote.saldoCentavos, falta);
    await tx.update(schema.creditoLote).set({ saldoCentavos: lote.saldoCentavos - usar }).where(eq(schema.creditoLote.id, lote.id));
    await tx.insert(schema.creditoMovimento).values({
      loteId: lote.id,
      tipo: 'uso',
      valorCentavos: -usar,
      reservaId: p.reservaId ?? null,
      cobrancaId: p.cobrancaId ?? null,
    });
    falta -= usar;
  }
  return p.ate - falta;
}

/** Zera o saldo dos lotes vencidos e registra o vencimento. Roda no worker; devolve quantos lotes venceram. */
export async function vencerLotes(agora = new Date()): Promise<number> {
  return db.transaction(async (tx) => {
    const vencidos = await tx
      .select()
      .from(schema.creditoLote)
      .where(and(sql`${schema.creditoLote.validadeAte} <= ${agora}`, gt(schema.creditoLote.saldoCentavos, 0)))
      .for('update');
    for (const lote of vencidos) {
      await tx.update(schema.creditoLote).set({ saldoCentavos: 0 }).where(eq(schema.creditoLote.id, lote.id));
      await tx.insert(schema.creditoMovimento).values({ loteId: lote.id, tipo: 'vencimento', valorCentavos: -lote.saldoCentavos });
    }
    return vencidos.length;
  });
}

/** Lotes ainda com saldo (para a tela de carteira) e extrato dos últimos movimentos. */
export async function carteiraDoProfissional(profissionalId: string, agora = new Date()) {
  const lotes = await db
    .select()
    .from(schema.creditoLote)
    .where(and(eq(schema.creditoLote.profissionalId, profissionalId), gt(schema.creditoLote.saldoCentavos, 0), gt(schema.creditoLote.validadeAte, agora)))
    .orderBy(asc(schema.creditoLote.validadeAte));
  const extrato = await db
    .select({
      id: schema.creditoMovimento.id,
      tipo: schema.creditoMovimento.tipo,
      valorCentavos: schema.creditoMovimento.valorCentavos,
      criadoEm: schema.creditoMovimento.criadoEm,
      origem: schema.creditoLote.origem,
    })
    .from(schema.creditoMovimento)
    .innerJoin(schema.creditoLote, eq(schema.creditoLote.id, schema.creditoMovimento.loteId))
    .where(eq(schema.creditoLote.profissionalId, profissionalId))
    .orderBy(desc(schema.creditoMovimento.criadoEm))
    .limit(50);
  return { saldoCentavos: lotes.reduce((s, l) => s + l.saldoCentavos, 0), lotes, extrato };
}
