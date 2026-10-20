import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { formatarReais } from '@/lib/dinheiro';
import { registrarAuditoria } from '@/modulos/auditoria/auditoria';
import { emailCreditoConcedido } from '@/modulos/comunicacao/modelos';
import { notificar } from '@/modulos/comunicacao/notificar';
import { concederCredito } from './carteira';

export const CREDITO_MANUAL_MAXIMO_CENTAVOS = 1_000_000; // R$ 10.000: trava contra erro de digitação

export class CreditoManualInvalidoError extends Error {
  constructor(public readonly motivo: 'valor' | 'justificativa') {
    super(motivo === 'valor' ? 'Valor de crédito inválido.' : 'Informe o motivo do crédito.');
    this.name = 'CreditoManualInvalidoError';
  }
}

export class ProfissionalSemCadastroError extends Error {
  constructor() {
    super('Profissional não encontrado.');
    this.name = 'ProfissionalSemCadastroError';
  }
}

/**
 * O Anfitrião coloca crédito na carteira de um Profissional (cortesia, acerto, devolução por
 * fora). Exige um motivo, que fica no histórico (D7: quem deu crédito, quando e por quê), e avisa
 * a pessoa por e-mail.
 */
export async function concederCreditoManual(
  p: { anfitriaoId: string; profissionalId: string; espacoId: string; valorCentavos: number; motivo: string },
  opcoes: { ip?: string | null } = {},
  agora = new Date(),
) {
  const motivo = p.motivo.trim().slice(0, 300);
  if (motivo.length < 3) throw new CreditoManualInvalidoError('justificativa');
  if (!Number.isInteger(p.valorCentavos) || p.valorCentavos <= 0 || p.valorCentavos > CREDITO_MANUAL_MAXIMO_CENTAVOS) {
    throw new CreditoManualInvalidoError('valor');
  }
  const [prof] = await db
    .select({ nome: schema.usuario.name, email: schema.usuario.email })
    .from(schema.profissional)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.profissional.usuarioId))
    .where(eq(schema.profissional.usuarioId, p.profissionalId));
  if (!prof) throw new ProfissionalSemCadastroError();

  const lote = await concederCredito(
    db,
    { profissionalId: p.profissionalId, espacoId: p.espacoId, origem: 'ajuste_manual', valorCentavos: p.valorCentavos, criadoPor: p.anfitriaoId },
    agora,
  );
  await registrarAuditoria({
    usuarioId: p.anfitriaoId,
    acao: 'credito_manual',
    entidade: 'profissional',
    entidadeId: p.profissionalId,
    dados: { loteId: lote.id, valorCentavos: p.valorCentavos, motivo },
    ip: opcoes.ip ?? null,
  });
  const m = emailCreditoConcedido({ nome: prof.nome, valor: formatarReais(p.valorCentavos), motivo });
  await notificar({
    usuarioId: p.profissionalId,
    para: prof.email,
    tipo: 'credito_concedido',
    assunto: m.assunto,
    html: m.html,
    referenciaTipo: 'credito_lote',
    referenciaId: lote.id,
  });
  return lote;
}
