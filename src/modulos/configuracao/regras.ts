import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/db';
import { horaInteira } from './espaco';

const inteiro = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

/**
 * Regras e prazos da sala (T26). Os limites impedem valores que quebrariam o sistema, como uma
 * sala que fecha antes de abrir ou uma política de cancelamento em que cancelar mais tarde
 * devolve mais. O banco repete a regra do cancelamento (`regra_espaco_cancelamento_valido`).
 */
export const esquemaRegras = z
  .object({
    diasFuncionamento: z.array(inteiro(1, 7)).min(1, 'dias').transform((d) => [...new Set(d)].sort((a, b) => a - b)),
    abre: inteiro(0, 23),
    fecha: inteiro(1, 24),
    antecedenciaMinHoras: inteiro(0, 720),
    antecedenciaMaxDias: inteiro(1, 365),
    duracaoMinHoras: inteiro(1, 24),
    travaMinutos: inteiro(0, 240),
    prazoAprovacaoHoras: inteiro(1, 168),
    prazoPagamentoHoras: inteiro(1, 168),
    corteAntesInicioHoras: inteiro(0, 72),
    validadeCreditoDias: inteiro(1, 730),
    cancelamentoIntegralHoras: inteiro(0, 720),
    cancelamentoParcialHoras: inteiro(0, 720),
    cancelamentoParcialPct: inteiro(0, 100),
    descontoPacoteMesPct: inteiro(0, 100),
    avisoRenovacaoSerieDias: inteiro(1, 30),
    horaLembreteVespera: inteiro(0, 23),
  })
  .superRefine((r, ctx) => {
    const erro = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (r.fecha <= r.abre) erro('fecha', 'horario');
    if (r.cancelamentoIntegralHoras < r.cancelamentoParcialHoras) erro('cancelamentoIntegralHoras', 'cancelamento');
    if (r.antecedenciaMinHoras < r.corteAntesInicioHoras) erro('antecedenciaMinHoras', 'antecedencia');
  });

export type EntradaRegras = z.input<typeof esquemaRegras>;
export type Regras = z.output<typeof esquemaRegras>;

/** Textos curtos para a tela: o motivo vem do código do problema, nunca de texto da URL. */
export const TEXTO_ERRO_REGRAS: Record<string, string> = {
  dias: 'Marque pelo menos um dia de funcionamento.',
  horario: 'A sala precisa fechar depois de abrir.',
  cancelamento: 'No cancelamento, o prazo para devolução integral não pode ser menor que o do parcial.',
  antecedencia: 'A antecedência mínima não pode ser menor que o corte antes do início.',
  invalido: 'Confira os números: algum valor está fora do permitido.',
};

export function lerRegras(entrada: unknown): { ok: true; regras: Regras } | { ok: false; erro: keyof typeof TEXTO_ERRO_REGRAS } {
  const r = esquemaRegras.safeParse(entrada);
  if (r.success) return { ok: true, regras: r.data };
  const msg = r.error.issues[0]?.message;
  return { ok: false, erro: msg && msg in TEXTO_ERRO_REGRAS ? msg : 'invalido' };
}

/** As regras como a tela as edita (horas inteiras). */
export function regrasParaTela(linha: typeof schema.regraEspaco.$inferSelect): Regras {
  return {
    diasFuncionamento: linha.diasFuncionamento,
    abre: horaInteira(linha.abre),
    fecha: horaInteira(linha.fecha),
    antecedenciaMinHoras: linha.antecedenciaMinHoras,
    antecedenciaMaxDias: linha.antecedenciaMaxDias,
    duracaoMinHoras: linha.duracaoMinHoras,
    travaMinutos: linha.travaMinutos,
    prazoAprovacaoHoras: linha.prazoAprovacaoHoras,
    prazoPagamentoHoras: linha.prazoPagamentoHoras,
    corteAntesInicioHoras: linha.corteAntesInicioHoras,
    validadeCreditoDias: linha.validadeCreditoDias,
    cancelamentoIntegralHoras: linha.cancelamentoIntegralHoras,
    cancelamentoParcialHoras: linha.cancelamentoParcialHoras,
    cancelamentoParcialPct: linha.cancelamentoParcialPct,
    descontoPacoteMesPct: linha.descontoPacoteMesPct,
    avisoRenovacaoSerieDias: linha.avisoRenovacaoSerieDias,
    horaLembreteVespera: horaInteira(linha.horaLembreteVespera),
  };
}

const hhmm = (h: number) => `${String(h).padStart(2, '0')}:00`;

/**
 * Grava as regras e registra na auditoria só o que mudou (antes e depois), com quem mudou.
 * Vale para pedidos novos: reservas e cobranças já criadas guardam os valores da época.
 */
export async function salvarRegras(espacoId: string, usuarioId: string, regras: Regras, ip?: string | null) {
  return db.transaction(async (tx) => {
    const [atual] = await tx.select().from(schema.regraEspaco).where(eq(schema.regraEspaco.espacoId, espacoId));
    if (!atual) throw new Error('A sala não tem regras cadastradas.');

    const antes = regrasParaTela(atual) as Record<string, unknown>;
    const depois = regras as Record<string, unknown>;
    const mudou = Object.keys(depois).filter((k) => JSON.stringify(antes[k]) !== JSON.stringify(depois[k]));
    if (mudou.length === 0) return { mudou: [] as string[] };

    await tx
      .update(schema.regraEspaco)
      .set({
        ...regras,
        abre: hhmm(regras.abre),
        fecha: hhmm(regras.fecha),
        horaLembreteVespera: hhmm(regras.horaLembreteVespera),
        atualizadoPor: usuarioId,
        atualizadoEm: new Date(),
      })
      .where(eq(schema.regraEspaco.espacoId, espacoId));

    await tx.insert(schema.eventoAuditoria).values({
      usuarioId,
      acao: 'regras_alteradas',
      entidade: 'espaco',
      entidadeId: espacoId,
      dados: { antes: Object.fromEntries(mudou.map((k) => [k, antes[k]])), depois: Object.fromEntries(mudou.map((k) => [k, depois[k]])) },
      ip: ip ?? null,
    });
    return { mudou };
  });
}
