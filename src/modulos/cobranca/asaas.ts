import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { partesLocais } from '@/lib/fuso';

/**
 * Cliente mínimo da API v3 do Asaas (só o que o sistema usa). Pagamento online só é usado quando
 * `ASAAS_ATIVO=true` e há chave: desligado, o fluxo continua sendo o Pix manual da E2. Nenhum dado
 * de cartão passa por aqui: o cartão é pago na página de fatura do próprio Asaas.
 */
export const asaasAtivo = () => process.env.ASAAS_ATIVO === 'true' && Boolean(process.env.ASAAS_API_KEY);

export class AsaasErro extends Error {
  constructor(
    public readonly status: number,
    public readonly corpo: unknown,
    caminho: string,
  ) {
    super(`Asaas ${caminho} respondeu ${status}`);
    this.name = 'AsaasErro';
  }
}

async function chamar<T>(caminho: string, init: RequestInit = {}): Promise<T> {
  const base = process.env.ASAAS_BASE_URL ?? 'https://api-sandbox.asaas.com/v3';
  const resp = await fetch(`${base}${caminho}`, {
    ...init,
    signal: AbortSignal.timeout(15_000),
    headers: { 'Content-Type': 'application/json', access_token: process.env.ASAAS_API_KEY!, 'User-Agent': 'subloc-consultorio', ...init.headers },
  });
  const corpo = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new AsaasErro(resp.status, corpo, caminho);
  return corpo as T;
}

const emReais = (centavos: number) => Number((centavos / 100).toFixed(2));
const dataAsaas = (d: Date) => {
  const p = partesLocais(d);
  return `${p.ano}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`;
};

/** Cliente do Asaas do Profissional: cria na primeira vez (CPF, nome, e-mail) e reaproveita depois. */
export async function garantirCliente(profissionalId: string): Promise<string> {
  const [p] = await db
    .select({ asaasClienteId: schema.profissional.asaasClienteId, cpf: schema.profissional.cpf, nome: schema.usuario.name, email: schema.usuario.email })
    .from(schema.profissional)
    .innerJoin(schema.usuario, eq(schema.usuario.id, schema.profissional.usuarioId))
    .where(eq(schema.profissional.usuarioId, profissionalId));
  if (!p) throw new Error('Profissional não encontrado.');
  if (p.asaasClienteId) return p.asaasClienteId;

  const criado = await chamar<{ id: string }>('/customers', {
    method: 'POST',
    // notificationDisabled: quem avisa o Profissional somos nós, para não chegar e-mail duplicado do Asaas.
    body: JSON.stringify({ name: p.nome, cpfCnpj: p.cpf, email: p.email, notificationDisabled: true, externalReference: profissionalId }),
  });
  await db.update(schema.profissional).set({ asaasClienteId: criado.id }).where(eq(schema.profissional.usuarioId, profissionalId));
  return criado.id;
}

export type CobrancaPix = { id: string; faturaUrl: string | null; copiaCola: string; qrImagem: string | null };

export async function criarCobrancaPix(p: {
  clienteId: string;
  valorCentavos: number;
  venceEm: Date;
  descricao: string;
  /** Nossa cobrança: volta no webhook e é conferida antes de confirmar qualquer coisa. */
  referencia: string;
}): Promise<CobrancaPix> {
  const pagamento = await chamar<{ id: string; invoiceUrl?: string }>('/payments', {
    method: 'POST',
    body: JSON.stringify({
      customer: p.clienteId,
      billingType: 'PIX',
      value: emReais(p.valorCentavos),
      dueDate: dataAsaas(p.venceEm),
      description: p.descricao.slice(0, 500),
      externalReference: p.referencia,
    }),
  });
  const qr = await chamar<{ payload: string; encodedImage?: string }>(`/payments/${pagamento.id}/pixQrCode`);
  return { id: pagamento.id, faturaUrl: pagamento.invoiceUrl ?? null, copiaCola: qr.payload, qrImagem: qr.encodedImage ?? null };
}

/** Cancela a cobrança no Asaas (ao cancelar a reserva sem pagamento). Melhor esforço: quem chama trata a falha. */
export async function cancelarCobrancaAsaas(asaasCobrancaId: string): Promise<void> {
  await chamar(`/payments/${asaasCobrancaId}`, { method: 'DELETE' });
}
