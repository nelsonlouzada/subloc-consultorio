import { timingSafeEqual } from 'node:crypto';
import * as Sentry from '@sentry/nextjs';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db, schema } from '@/db';
import { aplicarEventoAsaas } from '@/modulos/cobranca/webhook';

function tokenValido(recebido: string | null): boolean {
  const esperado = process.env.ASAAS_WEBHOOK_TOKEN;
  if (!esperado || !recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Recebe os avisos do Asaas, autentica pelo token e aplica o pagamento. Idempotente: um aviso
 * repetido (o Asaas reenvia) nunca é aplicado duas vezes, mas um aviso que FALHOU é reaplicado
 * quando chega de novo. Resposta 200 = "recebi e tratei" (inclusive problemas de dados, que ficam
 * em `webhook_evento.erro` para olhar); 500 só para falha inesperada, para o Asaas tentar outra vez.
 */
export async function POST(req: Request) {
  if (!tokenValido(req.headers.get('asaas-access-token'))) {
    return NextResponse.json({ erro: 'não autorizado' }, { status: 401 });
  }

  const corpo = await req.json().catch(() => null);
  if (!corpo?.id || !corpo?.event) {
    return NextResponse.json({ erro: 'evento inválido' }, { status: 400 });
  }
  const eventoId = String(corpo.id);

  await db
    .insert(schema.webhookEvento)
    .values({ provedor: 'asaas', eventoId, tipo: String(corpo.event), payload: corpo })
    .onConflictDoNothing({ target: schema.webhookEvento.eventoId });
  const [evento] = await db.select().from(schema.webhookEvento).where(eq(schema.webhookEvento.eventoId, eventoId));
  if (evento.processadoEm) return NextResponse.json({ ok: true, duplicado: true });

  try {
    const r = await aplicarEventoAsaas(corpo);
    await db
      .update(schema.webhookEvento)
      .set({ processadoEm: new Date(), erro: r.situacao === 'problema' ? (r.detalhe ?? 'problema') : null })
      .where(eq(schema.webhookEvento.id, evento.id));
    if (r.situacao === 'problema') Sentry.captureMessage(`Aviso do Asaas com problema: ${r.detalhe}`, { level: 'warning', tags: { fluxo: 'asaas_webhook' } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    await db
      .update(schema.webhookEvento)
      .set({ erro: e instanceof Error ? e.message.slice(0, 500) : 'erro inesperado' })
      .where(eq(schema.webhookEvento.id, evento.id));
    Sentry.captureException(e, { tags: { fluxo: 'asaas_webhook' } });
    return NextResponse.json({ erro: 'falha ao processar' }, { status: 500 });
  }
}
