import Link from 'next/link';
import { formatarReais } from '@/lib/dinheiro';
import { exigirProfissional } from '@/lib/sessao';
import { descreverPeriodo } from '@/modulos/agenda/calendario';
import { ROTULO_STATUS } from '@/modulos/agenda/consulta';
import { listarReservasDoProfissional } from '@/modulos/agenda/reserva';

export const metadata = { title: 'Minhas reservas' };

const ABAS = [
  { chave: 'pendentes', nome: 'Pendentes' },
  { chave: 'proximas', nome: 'Próximas' },
  { chave: 'passadas', nome: 'Passadas' },
] as const;

export default async function MinhasReservas({ searchParams }: { searchParams: Promise<{ aba?: string }> }) {
  const { sessao } = await exigirProfissional();
  const { aba } = await searchParams;
  const todas = await listarReservasDoProfissional(sessao.user.id);
  const agora = new Date();

  const pendentes = todas.filter((r) => r.status === 'solicitada' || r.status === 'aguardando_pagamento');
  const proximas = todas.filter((r) => r.status === 'confirmada' && r.fim > agora).sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
  const passadas = todas.filter((r) => !pendentes.includes(r) && !proximas.includes(r));
  const grupos = { pendentes, proximas, passadas };

  // Abre onde há o que olhar: pendentes se houver, senão as próximas.
  const padrao = pendentes.length > 0 ? 'pendentes' : 'proximas';
  const atual = ABAS.find((a) => a.chave === aba)?.chave ?? padrao;
  const lista = grupos[atual];

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">Minhas reservas</h1>

      <nav aria-label="Filtrar reservas" className="flex gap-2 text-sm">
        {ABAS.map((a) => (
          <Link
            key={a.chave}
            href={`/minhas-reservas?aba=${a.chave}`}
            aria-current={a.chave === atual ? 'page' : undefined}
            className={`rounded-lg border px-3 py-1.5 ${a.chave === atual ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white'}`}
          >
            {a.nome} ({grupos[a.chave].length})
          </Link>
        ))}
      </nav>

      {lista.length === 0 ? (
        <p className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
          Nada por aqui.{' '}
          <Link href="/reservar" className="underline">
            Reservar a sala
          </Link>
        </p>
      ) : (
        <ul className="space-y-2">
          {lista.map((r) => {
            const s = ROTULO_STATUS[r.status] ?? { nome: r.status, cor: 'bg-zinc-100 text-zinc-700' };
            return (
              <li key={r.id}>
                <Link href={`/minhas-reservas/${r.id}`} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3 text-sm hover:border-zinc-400">
                  <span className="font-medium">{descreverPeriodo(r.inicio, r.fim)}</span>
                  <span className="text-zinc-600">{formatarReais(r.valorCentavos)}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${s.cor}`}>{s.nome}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
