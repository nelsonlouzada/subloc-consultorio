import Link from 'next/link';
import BotaoSair from '@/app/BotaoSair';
import { exigirAnfitriao } from '@/lib/sessao';
import { contarSolicitacoes } from '@/modulos/agenda/solicitacao';
import { carregarSala } from '@/modulos/configuracao/espaco';
import { contarPendentes } from '@/modulos/identidade/aprovacao';

export default async function LayoutAnfitriao({ children }: { children: React.ReactNode }) {
  const sessao = await exigirAnfitriao();
  const sala = await carregarSala();
  const [pendentes, solicitacoes] = await Promise.all([
    contarPendentes(),
    sala ? contarSolicitacoes(sala.espaco.id) : Promise.resolve(0),
  ]);
  return (
    <div className="min-h-screen">
      <header className="glass-bar">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-5 py-3">
          <span className="text-base font-semibold tracking-tight">Painel da sala</span>
          <nav aria-label="Principal" className="flex flex-wrap gap-1">
            <Link href="/inicio" className="nav-link">
              Início
            </Link>
            <Link href="/agenda" className="nav-link">
              Agenda
            </Link>
            <Link href="/solicitacoes" className="nav-link">
              Solicitações
              {solicitacoes > 0 && (
                <span className="nav-badge">
                  {solicitacoes}
                  <span className="sr-only"> pedido(s) para aprovar</span>
                </span>
              )}
            </Link>
            <Link href="/profissionais" className="nav-link">
              Profissionais
              {pendentes > 0 && (
                <span className="nav-badge">
                  {pendentes}
                  <span className="sr-only"> cadastro(s) para aprovar</span>
                </span>
              )}
            </Link>
            <Link href="/financeiro" className="nav-link">
              Financeiro
            </Link>
            <Link href="/auditoria" className="nav-link">
              Auditoria
            </Link>
            <Link href="/configuracoes" className="nav-link">
              Configurações
            </Link>
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-zinc-600">{sessao.user.name}</span>
            <BotaoSair />
          </div>
        </div>
      </header>
      <main className="enter mx-auto max-w-6xl px-5 py-10">{children}</main>
    </div>
  );
}
