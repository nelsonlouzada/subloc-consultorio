import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/db';
import { exigirProfissional } from '@/lib/sessao';
import { formatarReais } from '@/lib/dinheiro';
import PagamentoPix from '../../../PagamentoPix';

export const metadata = { title: 'Pagar crédito' };

/** T12 para a compra de pacote de crédito: mesma tela de pagamento da reserva. */
export default async function PagarCredito({ params }: { params: Promise<{ id: string }> }) {
  const { sessao } = await exigirProfissional();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const [c] = await db
    .select({ cobranca: schema.cobranca, pacote: schema.pacoteCredito.nome, credito: schema.pacoteCredito.valorCreditoCentavos })
    .from(schema.cobranca)
    .innerJoin(schema.cobrancaItem, eq(schema.cobrancaItem.cobrancaId, schema.cobranca.id))
    .innerJoin(schema.pacoteCredito, eq(schema.pacoteCredito.id, schema.cobrancaItem.pacoteCreditoId))
    .where(eq(schema.cobranca.id, id));
  // Cobrança de outra pessoa é como se não existisse.
  if (!c || c.cobranca.profissionalId !== sessao.user.id || c.cobranca.finalidade !== 'compra_credito') notFound();
  const { cobranca } = c;

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <Link href="/carteira" className="text-sm underline">
        ← Carteira
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">{c.pacote}</h1>
      <p className="text-sm text-zinc-700">
        Você paga {formatarReais(cobranca.valorCobradoCentavos)} e recebe <strong>{formatarReais(c.credito)}</strong> em crédito.
      </p>

      {cobranca.status === 'paga' ? (
        <section className="space-y-2 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-950">
          <h2 className="font-semibold">Pagamento recebido</h2>
          <p>O crédito já está na sua carteira.</p>
          <p>
            <a href={`/api/recibos/${cobranca.id}`} target="_blank" rel="noopener noreferrer" className="underline">
              Baixar recibo (PDF)
            </a>
          </p>
        </section>
      ) : cobranca.status === 'pendente' && cobranca.pixCopiaCola ? (
        <section className="space-y-2 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-950">
          <h2 className="font-semibold">Pague por Pix</h2>
          <PagamentoPix valorCentavos={cobranca.valorCobradoCentavos} copiaCola={cobranca.pixCopiaCola} qrImagem={cobranca.pixQrImagem} faturaUrl={cobranca.asaasLinkFatura} />
          <p className="text-xs">Esta página não atualiza sozinha: depois de pagar, volte à Carteira.</p>
        </section>
      ) : (
        <p className="card p-5 text-sm text-zinc-700">Esta cobrança não está mais aberta.</p>
      )}
    </div>
  );
}
