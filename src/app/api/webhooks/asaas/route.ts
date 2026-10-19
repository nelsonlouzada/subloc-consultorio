import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { db, schema } from '@/db';

// Recebe os avisos do Asaas. Na E0 só autentica e registra o evento (prova de que o webhook chega).
// A confirmação de reservas a partir do pagamento entra na E4.
function tokenValido(recebido: string | null): boolean {
  const esperado = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!esperado || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!tokenValido(req.headers.get('asaas-access-token'))) {
    return NextResponse.json({ erro: 'não autorizado' }, { status: 401 });
  }

  const corpo = await req.json().catch(() => null);
  if (!corpo?.id || !corpo?.event) {
    return NextResponse.json({ erro: 'evento inválido' }, { status: 400 });
  }

  // Idempotência: se o evento já existe, responde 200 sem reprocessar.
  await db
    .insert(schema.webhookEvento)
    .values({ provedor: 'asaas', eventoId: String(corpo.id), tipo: String(corpo.event), payload: corpo })
    .onConflictDoNothing({ target: schema.webhookEvento.eventoId });

  return NextResponse.json({ ok: true });
}
