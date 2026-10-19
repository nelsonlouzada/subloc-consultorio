import Link from 'next/link';
import { exigirAnfitriao } from '@/lib/sessao';
import BotaoSair from './BotaoSair';

export default async function LayoutAnfitriao({ children }: { children: React.ReactNode }) {
  const sessao = await exigirAnfitriao();
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold">Painel da sala</span>
          <nav aria-label="Principal" className="flex gap-4 text-sm">
            <Link href="/inicio" className="hover:underline">
              Início
            </Link>
            <Link href="/agenda" className="hover:underline">
              Agenda
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-zinc-600">{sessao.user.name}</span>
            <BotaoSair />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
