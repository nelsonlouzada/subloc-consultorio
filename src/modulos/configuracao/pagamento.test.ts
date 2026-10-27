import { afterAll, describe, expect, it } from 'vitest';
import { pool } from '@/db';
import { fabrica } from '@/test/fabrica';
import { estadoPagamento, listarAnfitrioes } from './pagamento';

const f = fabrica();
afterAll(async () => {
  await f.limpar();
  await pool.end();
});

describe('estado do pagamento', () => {
  it('diz só se está configurado, nunca o valor do segredo', () => {
    const e = estadoPagamento({ PIX_MANUAL_CHAVE: 'chave-secreta@x.com', PIX_MANUAL_NOME: ' Maria ', ASAAS_API_KEY: 'segredo', ASAAS_WEBHOOK_TOKEN: 'tok', ASAAS_ATIVO: 'true' });
    expect(e).toEqual({
      pixManual: { chaveConfigurada: true, favorecido: 'Maria' },
      asaas: { ligado: true, chaveConfigurada: true, tokenWebhookConfigurado: true, sandbox: true },
      recibo: { emitente: null, documentoConfigurado: false },
    });
    expect(JSON.stringify(e)).not.toMatch(/segredo|tok"|chave-secreta/);
  });

  it('Asaas desligado sem a variável, ou ligado sem chave; produção quando a URL não é de sandbox', () => {
    expect(estadoPagamento({ ASAAS_API_KEY: 'k' }).asaas.ligado).toBe(false);
    expect(estadoPagamento({ ASAAS_ATIVO: 'true' }).asaas.ligado).toBe(false);
    expect(estadoPagamento({ ASAAS_BASE_URL: 'https://api.asaas.com/v3' }).asaas.sandbox).toBe(false);
    expect(estadoPagamento({}).pixManual).toEqual({ chaveConfigurada: false, favorecido: null });
  });
});

describe('contas de Anfitrião', () => {
  it('lista só Anfitriões, sem Profissionais', async () => {
    const anf = await f.anfitriao();
    const prof = await f.profissional();
    const ids = (await listarAnfitrioes()).map((a) => a.id);
    expect(ids).toContain(anf);
    expect(ids).not.toContain(prof);
  });
});
