import Link from 'next/link';
import { exigirProfissional } from '@/lib/sessao';
import BotaoSair from '@/app/BotaoSair';

export default async function LayoutProfissional({ children }: { children: React.ReactNode }) {
  const { sessao, profissional } = await exigirProfissional();
  return (
    <div className="min-h-screen">
      <header className="glass-bar">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-8 gap-y-2 px-5 py-3">
          <span className="text-base font-semibold tracking-tight">Reservas da sala</span>
          <nav aria-label="Principal" className="flex flex-wrap gap-1">
            <Link href="/reservar" className="nav-link">
              Reservar
            </Link>
            <Link href="/minhas-reservas" className="nav-link">
              Minhas reservas
            </Link>
            <Link href="/series" className="nav-link">
              Séries
            </Link>
            <Link href="/carteira" className="nav-link">
              Carteira
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-zinc-600">{sessao.user.name}</span>
            <BotaoSair />
          </div>
        </div>
      </header>

      {profissional.status === 'pendente' && (
        <p role="status" className="border-b border-amber-200/70 bg-amber-50 px-5 py-2.5 text-center text-sm text-amber-900">
          Seu cadastro está em análise. Você já pode ver a agenda e pedir reservas; elas serão aprovadas junto com o cadastro.
        </p>
      )}
      {profissional.status === 'recusado' && (
        <p role="alert" className="border-b border-red-200/70 bg-red-50 px-5 py-2.5 text-center text-sm text-red-900">
          Seu cadastro não foi aprovado. Para saber mais, responda ao e-mail que enviamos.
        </p>
      )}
      {profissional.status === 'bloqueado' && (
        <p role="alert" className="border-b border-red-200/70 bg-red-50 px-5 py-2.5 text-center text-sm text-red-900">
          Seu acesso para novas reservas está bloqueado. Fale com os responsáveis pela sala.
        </p>
      )}

      <main className="enter mx-auto max-w-5xl px-5 py-10">{children}</main>
    </div>
  );
}
