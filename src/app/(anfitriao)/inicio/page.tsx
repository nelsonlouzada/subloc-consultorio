import Link from 'next/link';
import { exigirAnfitriao } from '@/lib/sessao';
import { somarDias, formatarDataISO, type DataLocal } from '@/lib/fuso';
import { listarAgenda } from '@/modulos/agenda/bloqueio';
import { hojeLocal, horaTexto, limitesDoDia, nomeDiaCurto } from '@/modulos/agenda/calendario';
import { listarReservasNoPeriodo } from '@/modulos/agenda/reserva';
import { contarSolicitacoes } from '@/modulos/agenda/solicitacao';
import { carregarSala } from '@/modulos/configuracao/espaco';
import { contarPendentes } from '@/modulos/identidade/aprovacao';

const TIPO = { uso_proprio: 'Uso próprio', indisponivel: 'Indisponível' } as const;
const STATUS: Record<string, string> = {
  solicitada: 'aguardando aprovação',
  aguardando_pagamento: 'aguardando pagamento',
  confirmada: 'confirmada',
  realizada: 'realizada',
  falta: 'falta',
};

async function Dia({ titulo, d, espacoId }: { titulo: string; d: DataLocal; espacoId: string }) {
  const [ini, fim] = limitesDoDia(d);
  const [bloqueios, reservas] = await Promise.all([listarAgenda(espacoId, ini, fim), listarReservasNoPeriodo(espacoId, ini, fim)]);
  const itens = [
    ...bloqueios.map((b) => ({ id: b.id, inicio: b.inicio, fim: b.fim, texto: `${TIPO[b.tipo]}${b.motivo ? ` · ${b.motivo}` : ''}` })),
    ...reservas.map((r) => ({ id: r.id, inicio: r.inicio, fim: r.fim, texto: `Reserva (${STATUS[r.status] ?? r.status}) · ${r.profissional}` })),
  ].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4">
      <h2 className="mb-1 font-semibold">
        {titulo} <span className="text-sm font-normal text-zinc-600">({nomeDiaCurto(d)} {String(d.dia).padStart(2, '0')}/{String(d.mes).padStart(2, '0')})</span>
      </h2>
      {itens.length === 0 ? (
        <p className="text-sm text-zinc-600">Nada marcado.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {itens.map((i) => (
            <li key={i.id}>
              <strong>{horaTexto(i.inicio)}–{horaTexto(i.fim)}</strong> · {i.texto}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function Inicio() {
  const sessao = await exigirAnfitriao();
  const sala = await carregarSala();
  const hoje = hojeLocal();
  const pendentes = await contarPendentes();
  const solicitacoes = sala ? await contarSolicitacoes(sala.espaco.id) : 0;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Olá, {sessao.user.name.split(' ')[0]}</h1>

      <section aria-label="Pendências" className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="mb-1 font-semibold">O que precisa de ação</h2>
        {pendentes + solicitacoes > 0 ? (
          <ul className="space-y-1 text-sm">
            {solicitacoes > 0 && (
              <li>
                <Link href="/solicitacoes" className="font-medium underline">
                  {solicitacoes} {solicitacoes === 1 ? 'pedido de reserva espera' : 'pedidos de reserva esperam'} decisão
                </Link>
              </li>
            )}
            {pendentes > 0 && (
              <li>
                <Link href="/profissionais" className="font-medium underline">
                  {pendentes} {pendentes === 1 ? 'cadastro espera' : 'cadastros esperam'} aprovação
                </Link>
              </li>
            )}
          </ul>
        ) : (
          <p className="text-sm text-zinc-600">
            Nenhuma pendência. Códigos de acesso a enviar e pagamentos prestes a expirar aparecem aqui no próximo bloco.
          </p>
        )}
      </section>

      {sala ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Dia titulo="Hoje" d={hoje} espacoId={sala.espaco.id} />
          <Dia titulo="Amanhã" d={somarDias(hoje, 1)} espacoId={sala.espaco.id} />
        </div>
      ) : (
        <p className="rounded-lg bg-amber-50 p-4 text-amber-900">A sala ainda não foi cadastrada. Rode o seed do espaço.</p>
      )}

      <Link href={`/agenda?data=${formatarDataISO(hoje)}`} className="inline-block rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white">
        Abrir a agenda
      </Link>
    </div>
  );
}
