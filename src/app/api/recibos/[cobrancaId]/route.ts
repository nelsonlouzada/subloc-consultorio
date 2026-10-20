import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db, schema } from '@/db';
import { sessaoAtual } from '@/lib/sessao';
import { carregarRecibo, emitirRecibo, gerarPdfRecibo } from '@/modulos/cobranca/recibo';

/**
 * PDF do recibo de uma cobrança paga. Só o dono da cobrança e os Anfitriões veem; para qualquer
 * outra pessoa a resposta é a mesma de "não existe". O recibo é emitido aqui se ainda não existir
 * (a emissão é idempotente), então uma falha na emissão automática se corrige sozinha.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ cobrancaId: string }> }) {
  const sessao = await sessaoAtual();
  if (!sessao) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const { cobrancaId } = await params;
  const naoExiste = () => NextResponse.json({ erro: 'não encontrado' }, { status: 404 });
  if (!z.string().uuid().safeParse(cobrancaId).success) return naoExiste();

  const [c] = await db.select({ profissionalId: schema.cobranca.profissionalId }).from(schema.cobranca).where(eq(schema.cobranca.id, cobrancaId));
  if (!c) return naoExiste();
  const permitido = sessao.user.papel === 'anfitriao' || c.profissionalId === sessao.user.id;
  if (!permitido) return naoExiste();

  const recibo = await emitirRecibo(cobrancaId);
  if (!recibo) return naoExiste();
  const dados = await carregarRecibo(recibo.id);
  if (!dados) return naoExiste();

  const pdf = await gerarPdfRecibo(dados);
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="recibo-${String(dados.numero).padStart(6, '0')}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
