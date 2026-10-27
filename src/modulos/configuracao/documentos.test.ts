import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool, schema } from '@/db';
import { fabrica } from '@/test/fabrica';
import { documentoVigente, garantirDocumentosIniciais } from './documentos-iniciais';
import { listarVersoes, publicarVersao } from './documentos';

const f = fabrica();
const texto = (n: string) => `Cláusula de teste ${n}. `.repeat(10);
const criadas: string[] = [];

beforeAll(async () => {
  await garantirDocumentosIniciais();
});
afterAll(async () => {
  for (const id of criadas) await db.delete(schema.documentoLegal).where(eq(schema.documentoLegal.id, id));
  await f.limpar();
  await pool.end();
});

async function publicar(...args: Parameters<typeof publicarVersao>) {
  const r = await publicarVersao(...args);
  if (r.ok) {
    const [d] = await db.select().from(schema.documentoLegal).where(and(eq(schema.documentoLegal.tipo, args[0]), eq(schema.documentoLegal.versao, r.versao)));
    criadas.push(d.id);
  }
  return r;
}

describe('publicar versões de documentos', () => {
  it('cria a versão seguinte, torna-a vigente, guarda a anterior e audita', async () => {
    const anf = await f.anfitriao();
    const antes = (await documentoVigente('termo_reserva'))!;
    const r = await publicar('termo_reserva', anf, texto('A'), '203.0.113.6');
    expect(r).toEqual({ ok: true, versao: antes.versao + 1 });

    const vigente = (await documentoVigente('termo_reserva'))!;
    expect(vigente).toMatchObject({ versao: antes.versao + 1, publicadoPor: anf });
    expect(vigente.texto).toBe(texto('A').trim());

    const versoes = await listarVersoes('termo_reserva');
    expect(versoes[0]).toMatchObject({ versao: antes.versao + 1 });
    expect(versoes.find((v) => v.versao === antes.versao)?.texto).toBe(antes.texto); // a antiga não muda

    const [ev] = await db.select().from(schema.eventoAuditoria).where(and(eq(schema.eventoAuditoria.entidadeId, vigente.id), eq(schema.eventoAuditoria.acao, 'documento_publicado')));
    expect(ev.dados).toEqual({ tipo: 'termo_reserva', versao: antes.versao + 1 });
    expect(ev.usuarioId).toBe(anf);
  });

  it('recusa texto igual ao vigente (ignorando quebras de linha e espaços nas pontas)', async () => {
    const anf = await f.anfitriao();
    const vigente = (await documentoVigente('contrato'))!;
    expect(await publicarVersao('contrato', anf, `  ${vigente.texto.replace(/\n/g, '\r\n')}\n`)).toEqual({ ok: false, erro: 'igual' });
  });

  it.each([['curto', 'x'.repeat(49)], ['longo', 'x'.repeat(20_001)]])('recusa texto %s', async (_n, t) => {
    const anf = await f.anfitriao();
    expect(await publicarVersao('contrato', anf, t)).toEqual({ ok: false, erro: 'tamanho' });
  });

  it('duas publicações ao mesmo tempo nunca repetem a versão: cada uma entra com um número próprio ou é recusada', async () => {
    const anf = await f.anfitriao();
    const rs = await Promise.all([publicar('contrato', anf, texto('B')), publicar('contrato', anf, texto('C'))]);
    const aceitas = rs.flatMap((r) => (r.ok ? [r.versao] : []));
    expect(aceitas.length).toBeGreaterThanOrEqual(1);
    expect(new Set(aceitas).size).toBe(aceitas.length);
    for (const r of rs) if (!r.ok) expect(r.erro).toBe('concorrencia');

    const versoes = (await listarVersoes('contrato')).map((v) => v.versao).sort((a, b) => a - b);
    expect(versoes).toEqual(versoes.map((_, k) => k + 1)); // 1, 2, 3... sem buracos nem repetições
  });
});
