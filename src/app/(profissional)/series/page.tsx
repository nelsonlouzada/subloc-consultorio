import Link from 'next/link';
import { exigirProfissional } from '@/lib/sessao';
import { listarSeriesDoProfissional, ROTULO_SERIE } from '@/modulos/agenda/serie-consulta';

export const metadata = { title: 'Minhas séries' };

export default async function MinhasSeries() {
  const { sessao } = await exigirProfissional();
  const series = await listarSeriesDoProfissional(sessao.user.id);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Minhas séries</h1>
        <Link href="/reservar/serie" className="ml-auto rounded-lg border border-zinc-900 bg-white px-3 py-2 text-sm hover:bg-zinc-900 hover:text-white">
          Reservar um horário fixo
        </Link>
      </div>

      {series.length === 0 ? (
        <p className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
          Você ainda não tem séries. Uma série reserva o mesmo horário toda semana (ou a cada duas), com pedido e pagamento únicos.
        </p>
      ) : (
        <ul className="space-y-2">
          {series.map((s) => {
            const rotulo = ROTULO_SERIE[s.status] ?? { nome: s.status, cor: 'bg-zinc-100 text-zinc-700' };
            return (
              <li key={s.id}>
                <Link href={`/series/${s.id}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3 text-sm hover:border-zinc-400">
                  <span className="font-medium">{s.descricao}</span>
                  <span className="text-zinc-600">
                    {s.porVir} {s.porVir === 1 ? 'data por vir' : 'datas por vir'} · {s.formaPagamento === 'pacote_mes' ? 'pacote do mês' : 'por data'}
                  </span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${rotulo.cor}`}>{rotulo.nome}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
