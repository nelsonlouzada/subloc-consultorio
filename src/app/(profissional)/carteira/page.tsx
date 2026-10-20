import Link from 'next/link';
import { formatarReais } from '@/lib/dinheiro';
import { exigirProfissional } from '@/lib/sessao';
import { descreverMomento } from '@/modulos/agenda/calendario';
import { carteiraDoProfissional } from '@/modulos/carteira/carteira';

export const metadata = { title: 'Carteira' };

const ORIGEM = {
  compra: 'Compra de crédito',
  cancelamento: 'Cancelamento de reserva',
  pagamento_atrasado: 'Pagamento recebido depois do prazo',
  ajuste_manual: 'Crédito concedido pelos responsáveis',
} as const;
const MOVIMENTO = {
  entrada: 'Crédito recebido',
  uso: 'Crédito usado',
  devolucao_uso: 'Crédito devolvido',
  vencimento: 'Crédito vencido',
  ajuste: 'Ajuste',
} as const;

export default async function Carteira() {
  const { sessao } = await exigirProfissional();
  const { saldoCentavos, lotes, extrato } = await carteiraDoProfissional(sessao.user.id);

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="text-2xl font-semibold">Carteira</h1>

      <section className="rounded-2xl border border-zinc-200 bg-white p-4">
        <p className="text-sm text-zinc-600">Saldo disponível</p>
        <p className="text-3xl font-semibold">{formatarReais(saldoCentavos)}</p>
        {saldoCentavos > 0 && (
          <p className="mt-2 text-sm text-zinc-700">
            O crédito que vence primeiro é usado primeiro.{' '}
            <Link href="/reservar" className="underline">
              Reservar a sala
            </Link>
          </p>
        )}
      </section>

      {lotes.length > 0 && (
        <section aria-label="Validades" className="rounded-2xl border border-zinc-200 bg-white p-4">
          <h2 className="mb-2 font-semibold">Validades</h2>
          <ul className="space-y-1 text-sm">
            {lotes.map((l) => (
              <li key={l.id}>
                <strong>{formatarReais(l.saldoCentavos)}</strong> até {descreverMomento(l.validadeAte)} · {ORIGEM[l.origem]}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Extrato" className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">Extrato</h2>
        {extrato.length === 0 ? (
          <p className="text-sm text-zinc-600">Nenhuma movimentação ainda.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {extrato.map((m) => (
              <li key={m.id}>
                {descreverMomento(m.criadoEm)} · {MOVIMENTO[m.tipo]}: {m.valorCentavos < 0 ? '−' : '+'}
                {formatarReais(Math.abs(m.valorCentavos))}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
