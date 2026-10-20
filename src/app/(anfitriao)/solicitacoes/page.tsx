import Link from 'next/link';
import { formatarReais } from '@/lib/dinheiro';
import { exigirAnfitriao } from '@/lib/sessao';
import { descreverMomento, descreverPeriodo } from '@/modulos/agenda/calendario';
import { listarSolicitacoes } from '@/modulos/agenda/solicitacao';
import { carregarSala } from '@/modulos/configuracao/espaco';
import { CONSELHOS } from '@/modulos/identidade/opcoes';
import { aprovarSolicitacaoAction, recusarSolicitacaoAction } from './actions';

export const metadata = { title: 'Solicitações' };

const AVISOS: Record<string, string> = {
  aprovada: 'Pedido aprovado. O profissional recebeu os dados do pagamento por e-mail.',
  recusada: 'Pedido recusado e horário liberado. O profissional foi avisado por e-mail.',
};
const ERROS: Record<string, string> = {
  prazo: 'O prazo para aprovar este pedido já passou. O horário será liberado automaticamente.',
  cadastro: 'O cadastro deste profissional ainda não foi aprovado. Use "Aprovar cadastro e pedido".',
  estado: 'Este pedido já foi decidido ou expirou. A lista abaixo está atualizada.',
};
const UNIDADE = { hora: 'por hora', turno: 'turno', dia: 'dia inteiro' } as const;

const botao = 'rounded-lg px-4 py-2 text-sm font-medium';

export default async function Solicitacoes({ searchParams }: { searchParams: Promise<{ aviso?: string; erro?: string }> }) {
  await exigirAnfitriao();
  const { aviso, erro } = await searchParams;
  const sala = await carregarSala();
  if (!sala) return <p className="rounded-lg bg-amber-50 p-4 text-amber-900">A sala ainda não foi cadastrada.</p>;

  const todas = await listarSolicitacoes(sala.espaco.id);
  const paraAprovar = todas.filter((s) => s.status === 'solicitada');
  const aguardando = todas.filter((s) => s.status === 'aguardando_pagamento');

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Solicitações</h1>

      {aviso && AVISOS[aviso] && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
          {AVISOS[aviso]}
        </p>
      )}
      {erro && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          {ERROS[erro] ?? 'Não foi possível concluir.'}
        </p>
      )}

      <section aria-label="Para aprovar" className="space-y-3">
        <h2 className="text-lg font-semibold">Para aprovar ({paraAprovar.length})</h2>
        {paraAprovar.length === 0 && <p className="text-sm text-zinc-600">Nenhum pedido esperando aprovação.</p>}
        {paraAprovar.map((s) => {
          const pendente = s.profissionalStatus === 'pendente';
          return (
            <article key={s.id} className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <strong>{s.profissionalNome}</strong>
                <Link href={`/profissionais/${encodeURIComponent(s.profissionalId)}`} className="text-sm underline">
                  ver cadastro
                </Link>
                {pendente && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">Cadastro pendente</span>}
              </div>
              <p className="text-lg font-medium">{descreverPeriodo(s.inicio, s.fim)}</p>
              <p className="text-sm text-zinc-700">
                {UNIDADE[s.unidade]} · {formatarReais(s.valorCentavos)} · {CONSELHOS[s.conselho]} {s.registro}/{s.uf}
              </p>
              <p className="text-sm text-zinc-600">
                {s.realizadas} {s.realizadas === 1 ? 'reserva realizada' : 'reservas realizadas'}, {s.faltas}{' '}
                {s.faltas === 1 ? 'falta' : 'faltas'}
              </p>
              {s.prazoAprovacaoAte && (
                <p className="text-sm text-zinc-600">
                  Responder até <strong>{descreverMomento(s.prazoAprovacaoAte)}</strong> (depois disso o horário é liberado)
                </p>
              )}

              <div className="flex flex-wrap items-end gap-3">
                <form action={aprovarSolicitacaoAction}>
                  <input type="hidden" name="id" value={s.id} />
                  {pendente && <input type="hidden" name="aprovarCadastro" value="on" />}
                  <button type="submit" className={`${botao} bg-zinc-900 text-white`}>
                    {pendente ? 'Aprovar cadastro e pedido' : 'Aprovar'}
                  </button>
                </form>
                <form action={recusarSolicitacaoAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="id" value={s.id} />
                  <div>
                    <label htmlFor={`motivo-${s.id}`} className="block text-xs text-zinc-600">
                      Motivo da recusa (opcional)
                    </label>
                    <input id={`motivo-${s.id}`} name="motivo" maxLength={300} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
                  </div>
                  <button type="submit" className={`${botao} border border-red-700 text-red-800`}>
                    Recusar
                  </button>
                </form>
              </div>
            </article>
          );
        })}
      </section>

      <section aria-label="Aguardando pagamento" className="space-y-3">
        <h2 className="text-lg font-semibold">Aguardando pagamento ({aguardando.length})</h2>
        {aguardando.length === 0 && <p className="text-sm text-zinc-600">Nenhum pedido aprovado esperando pagamento.</p>}
        {aguardando.map((s) => (
          <article key={s.id} className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
            <p>
              <strong>{s.profissionalNome}</strong> · {descreverPeriodo(s.inicio, s.fim)} · {formatarReais(s.valorCentavos)}
            </p>
            {s.prazoPagamentoAte && (
              <p className="text-zinc-600">
                Pagar até <strong>{descreverMomento(s.prazoPagamentoAte)}</strong>. Sem pagamento até lá, o horário é liberado.
              </p>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
