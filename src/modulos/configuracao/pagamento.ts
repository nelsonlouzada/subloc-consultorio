import { asc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { asaasAtivo } from '@/modulos/cobranca/asaas';

/**
 * Situação do pagamento, só para leitura. Chaves e tokens moram nas variáveis do Railway e nunca
 * aparecem na tela: aqui só vai "configurado ou não" e o que é público (nome do favorecido).
 */
export type EstadoPagamento = {
  pixManual: { chaveConfigurada: boolean; favorecido: string | null };
  asaas: { ligado: boolean; chaveConfigurada: boolean; tokenWebhookConfigurado: boolean; sandbox: boolean };
  recibo: { emitente: string | null; documentoConfigurado: boolean };
};

export function estadoPagamento(env: Record<string, string | undefined> = process.env): EstadoPagamento {
  const tem = (v: string | undefined) => Boolean(v?.trim());
  return {
    pixManual: { chaveConfigurada: tem(env.PIX_MANUAL_CHAVE), favorecido: env.PIX_MANUAL_NOME?.trim() || null },
    asaas: {
      ligado: env === process.env ? asaasAtivo() : env.ASAAS_ATIVO === 'true' && tem(env.ASAAS_API_KEY),
      chaveConfigurada: tem(env.ASAAS_API_KEY),
      tokenWebhookConfigurado: tem(env.ASAAS_WEBHOOK_TOKEN),
      sandbox: !env.ASAAS_BASE_URL || env.ASAAS_BASE_URL.includes('sandbox'),
    },
    recibo: { emitente: env.RECIBO_EMITENTE_NOME?.trim() || null, documentoConfigurado: tem(env.RECIBO_EMITENTE_DOC) },
  };
}

/** Contas de Anfitrião (D7): nome, e-mail e situação. Contas novas são criadas por script, nunca por formulário. */
export async function listarAnfitrioes() {
  return db
    .select({ id: schema.usuario.id, nome: schema.usuario.name, email: schema.usuario.email, emailVerificado: schema.usuario.emailVerified, ativo: schema.usuario.ativo, criadoEm: schema.usuario.createdAt })
    .from(schema.usuario)
    .where(eq(schema.usuario.papel, 'anfitriao'))
    .orderBy(asc(schema.usuario.createdAt));
}
