import 'dotenv/config';

// Teste de risco da E0: pessoa física consegue cliente com CPF, cobrança Pix e QR Code no Asaas?
// Roda só no sandbox. Uso: npm run teste:asaas
const BASE = process.env.ASAAS_BASE_URL ?? 'https://api-sandbox.asaas.com/v3';
const CHAVE = process.env.ASAAS_API_KEY;

if (!CHAVE) throw new Error('Defina ASAAS_API_KEY no .env (chave do sandbox).');
if (!BASE.includes('sandbox')) throw new Error('Este teste só roda no sandbox.');

// CPF válido gerado na hora (o sandbox valida os dígitos).
function cpfValido(): string {
  const d = Array.from({ length: 9 }, () => Math.floor(Math.random() * 9));
  const dv = (nums: number[]) => {
    const soma = nums.reduce((s, n, i) => s + n * (nums.length + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(dv(d));
  d.push(dv(d));
  return d.join('');
}

async function asaas(caminho: string, init?: RequestInit) {
  const resp = await fetch(`${BASE}${caminho}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', access_token: CHAVE!, 'User-Agent': 'subloc-consultorio', ...init?.headers },
  });
  const corpo = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, corpo };
}

function relatar(passo: string, r: { ok: boolean; status: number; corpo: unknown }) {
  console.log(`${r.ok ? 'OK    ' : 'FALHOU'} ${passo} (HTTP ${r.status})`);
  if (!r.ok) console.log('       ', JSON.stringify(r.corpo));
  return r.ok;
}

async function main() {
  const cliente = await asaas('/customers', {
    method: 'POST',
    body: JSON.stringify({ name: 'Teste E0 Sublocacao', cpfCnpj: cpfValido(), email: 'teste-e0@example.com' }),
  });
  if (!relatar('criar cliente com CPF', cliente)) return;

  const venc = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
  const cobranca = await asaas('/payments', {
    method: 'POST',
    body: JSON.stringify({ customer: cliente.corpo.id, billingType: 'PIX', value: 50, dueDate: venc, description: 'Teste E0 - hora avulsa' }),
  });
  if (!relatar('criar cobranca Pix de R$ 50', cobranca)) return;

  const qr = await asaas(`/payments/${cobranca.corpo.id}/pixQrCode`);
  if (!relatar('obter QR Code e copia-e-cola', qr)) {
    console.log('\nSe falhou aqui, a conta provavelmente precisa de uma chave Pix cadastrada.');
    return;
  }
  console.log(`\nCobranca: ${cobranca.corpo.id}`);
  console.log(`Copia-e-cola (início): ${String(qr.corpo.payload).slice(0, 40)}...`);
  console.log(`Fatura: ${cobranca.corpo.invoiceUrl}`);
  console.log('\nPróximo: no painel do sandbox, abra esta cobrança e use "Confirmar pagamento" para disparar o webhook.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
