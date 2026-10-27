import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';

export type TipoDocumento = 'contrato' | 'termo_reserva';

export const ROTULO_DOCUMENTO: Record<TipoDocumento, string> = {
  contrato: 'Contrato do profissional',
  termo_reserva: 'Termo de reserva',
};

export const TEXTO_ERRO_DOCUMENTO: Record<string, string> = {
  tamanho: 'O texto precisa ter entre 50 e 20 mil caracteres.',
  igual: 'O texto é igual ao da versão em vigor. Altere algo para publicar uma nova versão.',
  concorrencia: 'Outra pessoa publicou uma versão ao mesmo tempo. Confira a lista e tente de novo.',
};

/** Versões do documento, da mais nova para a mais antiga. A mais nova é a que a pessoa aceita agora. */
export async function listarVersoes(tipo: TipoDocumento) {
  return db
    .select({
      id: schema.documentoLegal.id,
      versao: schema.documentoLegal.versao,
      texto: schema.documentoLegal.texto,
      publicadoEm: schema.documentoLegal.publicadoEm,
      publicadoPor: schema.usuario.name,
    })
    .from(schema.documentoLegal)
    .leftJoin(schema.usuario, eq(schema.usuario.id, schema.documentoLegal.publicadoPor))
    .where(eq(schema.documentoLegal.tipo, tipo))
    .orderBy(desc(schema.documentoLegal.versao));
}

/**
 * Publica uma versão nova. Versão publicada nunca é editada, porque cada aceite guarda a versão
 * exata que a pessoa aceitou. Quem já aceitou continua com a versão dela; cadastros e pedidos
 * novos passam a usar esta.
 */
export async function publicarVersao(tipo: TipoDocumento, usuarioId: string, textoBruto: string, ip?: string | null) {
  const texto = textoBruto.replace(/\r\n/g, '\n').trim();
  if (texto.length < 50 || texto.length > 20_000) return { ok: false as const, erro: 'tamanho' };

  try {
    return await db.transaction(async (tx) => {
      const [ultima] = await tx.select().from(schema.documentoLegal).where(eq(schema.documentoLegal.tipo, tipo)).orderBy(desc(schema.documentoLegal.versao)).limit(1);
      if (ultima && ultima.texto.replace(/\r\n/g, '\n').trim() === texto) return { ok: false as const, erro: 'igual' };

      const versao = (ultima?.versao ?? 0) + 1;
      const [criada] = await tx.insert(schema.documentoLegal).values({ tipo, versao, texto, publicadoPor: usuarioId }).returning({ id: schema.documentoLegal.id });
      await tx.insert(schema.eventoAuditoria).values({
        usuarioId,
        acao: 'documento_publicado',
        entidade: 'documento_legal',
        entidadeId: criada.id,
        dados: { tipo, versao },
        ip: ip ?? null,
      });
      return { ok: true as const, versao };
    });
  } catch (e) {
    // Duas publicações ao mesmo tempo: a restrição única (tipo, versão) deixa só uma.
    if ((e as { code?: string; cause?: { code?: string } }).code === '23505' || (e as { cause?: { code?: string } }).cause?.code === '23505') {
      return { ok: false as const, erro: 'concorrencia' };
    }
    throw e;
  }
}
