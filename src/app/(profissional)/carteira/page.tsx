import Link from 'next/link';
import { formatarReais } from '@/lib/dinheiro';
import { exigirProfissional } from '@/lib/sessao';
import { descreverMomento } from '@/modulos/agenda/calendario';
import { carteiraDoProfissional } from '@/modulos/carteira/carteira';
import { asaasAtivo } from '@/modulos/cobranca/asaas';
import { comprasPendentes, listarPacotesAtivos, TEXTO_ERRO_COMPRA, type ErroCompra } from '@/modulos/cobranca/pacotes';
import { carregarSala } from '@/modulos/configuracao/espaco';
import { comprarPacoteAction } from './actions';

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

export default async function Carteira({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  const { sessao, profissional } = await exigirProfissional();
  const { erro } = await searchParams;
  const { saldoCentavos, lotes, extrato } = await carteiraDoProfissional(sessao.user.id);
  const sala = await carregarSala();
  // Comprar crédito só aparece com o pagamento online ligado, cadastro aprovado e algum pacote ativo.
  const pacotes = sala && asaasAtivo() && profissional.status === 'aprovado' ? await listarPacotesAtivos(sala.espaco.id) : [];
  const pendentes = await comprasPendentes(sessao.user.id);

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="text-3xl font-bold tracking-tight">Carteira</h1>

      {erro && TEXTO_ERRO_COMPRA[erro as ErroCompra] && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          {TEXTO_ERRO_COMPRA[erro as ErroCompra]}
        </p>
      )}

      <section className="card p-5">
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

      {pendentes.length > 0 && (
        <section aria-label="Compras em aberto" className="space-y-1 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-950">
          <h2 className="font-semibold">Compras aguardando pagamento</h2>
          <ul className="space-y-1">
            {pendentes.map((c) => (
              <li key={c.id}>
                {c.pacote} · {formatarReais(c.valorCentavos)} ·{' '}
                <Link href={`/carteira/pagar/${c.id}`} className="underline">
                  Ver o Pix
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pacotes.length > 0 && (
        <section aria-label="Banco de horas" className="space-y-3 card p-5">
          <h2 className="font-semibold">Banco de horas</h2>
          <p className="text-sm text-zinc-700">Compre crédito adiantado e use nas suas reservas, com bônus.</p>
          <ul className="space-y-2">
            {pacotes.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 text-sm">
                <div>
                  <strong>{p.nome}</strong>
                  <div className="text-zinc-600">
                    Você paga {formatarReais(p.valorPagoCentavos)} e recebe {formatarReais(p.valorCreditoCentavos)}
                  </div>
                </div>
                <form action={comprarPacoteAction} className="ml-auto">
                  <input type="hidden" name="pacoteId" value={p.id} />
                  <button type="submit" className="btn btn-tinted btn-sm">
                    Comprar
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {lotes.length > 0 && (
        <section aria-label="Validades" className="card p-5">
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

      <section aria-label="Extrato" className="card p-5">
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
