import Link from 'next/link';
import { exigirAnfitriao } from '@/lib/sessao';
import { contarPendentes, listarProfissionais, type StatusProfissional } from '@/modulos/identidade/aprovacao';
import { PROFISSOES, STATUS_PROFISSIONAL } from '@/modulos/identidade/opcoes';

export const metadata = { title: 'Profissionais' };

const COR: Record<StatusProfissional, string> = {
  pendente: 'bg-amber-100 text-amber-900',
  aprovado: 'bg-green-100 text-green-900',
  recusado: 'bg-red-100 text-red-900',
  bloqueado: 'bg-zinc-200 text-zinc-800',
};

const FILTROS: { chave: StatusProfissional | 'todos'; nome: string }[] = [
  { chave: 'pendente', nome: 'Pendentes' },
  { chave: 'aprovado', nome: 'Aprovados' },
  { chave: 'recusado', nome: 'Recusados' },
  { chave: 'bloqueado', nome: 'Bloqueados' },
  { chave: 'todos', nome: 'Todos' },
];

export default async function Profissionais({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await exigirAnfitriao();
  const { status } = await searchParams;
  const filtro = FILTROS.find((f) => f.chave === status)?.chave ?? 'pendente';
  const [lista, pendentes] = await Promise.all([
    listarProfissionais(filtro === 'todos' ? undefined : filtro),
    contarPendentes(),
  ]);

  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-bold tracking-tight">Profissionais</h1>

      <nav aria-label="Filtrar por estado" className="flex flex-wrap gap-2 text-sm">
        {FILTROS.map((f) => (
          <Link
            key={f.chave}
            href={`/profissionais?status=${f.chave}`}
            aria-current={f.chave === filtro ? 'page' : undefined}
            className={`pill`}
          >
            {f.nome}
            {f.chave === 'pendente' && pendentes > 0 ? ` (${pendentes})` : ''}
          </Link>
        ))}
      </nav>

      {lista.length === 0 ? (
        <p className="card p-5 text-sm text-zinc-600">
          {filtro === 'pendente' ? 'Nenhum cadastro esperando aprovação.' : 'Nenhum profissional neste filtro.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {lista.map((p) => (
            <li key={p.id}>
              <Link href={`/profissionais/${encodeURIComponent(p.id)}`} className="card-link rounded-2xl p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <strong>{p.nome}</strong>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${COR[p.status]}`}>{STATUS_PROFISSIONAL[p.status]}</span>
                </div>
                <p className="mt-1 text-sm text-zinc-600">
                  {PROFISSOES[p.profissao]} · {p.conselho} {p.registroNumero}/{p.registroUf} · {p.email}
                </p>
                <p className="text-xs text-zinc-500">
                  Cadastro em {p.criadoEm.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
