import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool, schema } from '@/db';
import { fabrica } from '@/test/fabrica';
import { lerSala, salaParaTela, salvarSala } from './sala';

const f = fabrica();
afterAll(async () => {
  await f.limpar();
  await pool.end();
});

const base = {
  nome: 'Sala Centro',
  descricao: 'Sala silenciosa.',
  logradouro: 'Rua das Flores',
  numero: '100',
  complemento: '',
  bairro: 'Centro',
  cidade: 'Campinas',
  uf: 'sp',
  cep: '13010-000',
  comodidades: 'Wi-Fi\nAr-condicionado\n\n  Wi-Fi  \nSofá',
};
const ler = (ajuste: Record<string, unknown> = {}) => lerSala({ ...base, ...ajuste });

describe('validação dos dados da sala', () => {
  it('normaliza: vazio vira nulo, UF em maiúsculas, CEP com hífen e comodidades sem repetição', () => {
    const r = ler({ cep: '13010000' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dados).toMatchObject({ complemento: null, uf: 'SP', cep: '13010-000', comodidades: ['Wi-Fi', 'Ar-condicionado', 'Sofá'] });
    }
  });

  it('aceita endereço em branco (a sala ainda pode não ter endereço público)', () => {
    expect(ler({ logradouro: '', numero: '', bairro: '', cidade: '', uf: '', cep: '', comodidades: '' }).ok).toBe(true);
  });

  it.each([
    [{ nome: '   ' }, 'nome'],
    [{ nome: 'x'.repeat(81) }, 'nome'],
    [{ uf: 'XX' }, 'uf'],
    [{ cep: '123' }, 'cep'],
    [{ comodidades: Array.from({ length: 21 }, (_, i) => `c${i}`).join('\n') }, 'comodidades'],
    [{ comodidades: 'x'.repeat(41) }, 'comodidades'],
    [{ descricao: 'x'.repeat(1001) }, 'invalido'],
  ])('recusa %j com "%s"', (ajuste, erro) => {
    const r = ler(ajuste);
    expect(r).toEqual({ ok: false, erro });
  });
});

describe('salvar a sala', () => {
  it('grava e audita só o que mudou', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const r = ler();
    if (!r.ok) throw new Error('base inválida');

    const { mudou } = await salvarSala(espacoId, anf, r.dados, '203.0.113.8');
    expect(mudou.sort()).toEqual(['bairro', 'cep', 'cidade', 'comodidades', 'descricao', 'logradouro', 'nome', 'numero', 'uf']);
    const [linha] = await db.select().from(schema.espaco).where(eq(schema.espaco.id, espacoId));
    expect(salaParaTela(linha)).toEqual(r.dados);

    const [ev] = await db.select().from(schema.eventoAuditoria).where(and(eq(schema.eventoAuditoria.entidadeId, espacoId), eq(schema.eventoAuditoria.acao, 'sala_alterada')));
    expect(ev.usuarioId).toBe(anf);
    expect(ev.ip).toBe('203.0.113.8');
  });

  it('não grava nem audita quando nada mudou', async () => {
    const { espacoId } = await f.sala();
    const anf = await f.anfitriao();
    const [linha] = await db.select().from(schema.espaco).where(eq(schema.espaco.id, espacoId));
    expect((await salvarSala(espacoId, anf, salaParaTela(linha))).mudou).toEqual([]);
    expect(await db.select().from(schema.eventoAuditoria).where(eq(schema.eventoAuditoria.entidadeId, espacoId))).toHaveLength(0);
  });
});
