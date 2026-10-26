import Link from 'next/link';
import { exigirAnfitriao } from '@/lib/sessao';
import { somarDias, formatarDataISO, type DataLocal } from '@/lib/fuso';
import { listarAgenda } from '@/modulos/agenda/bloqueio';
import { descreverMomento, descreverPeriodo, hojeLocal, horaTexto, limitesDoDia, nomeDiaCurto } from '@/modulos/agenda/calendario';
import { listarPendenciasDaSala } from '@/modulos/agenda/pendencias';
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
    <section className="card p-5">
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

export const metadata = { title: 'Início' };

export default async function Inicio() {
  const sessao = await exigirAnfitriao();
  const sala = await carregarSala();
  const hoje = hojeLocal();
  const pendentes = await contarPendentes();
  const solicitacoes = sala ? await contarSolicitacoes(sala.espaco.id) : 0;
  const { codigosAEnviar, pagamentosExpirando } = sala
    ? await listarPendenciasDaSala(sala.espaco.id)
    : { codigosAEnviar: [], pagamentosExpirando: [] };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Olá, {sessao.user.name.split(' ')[0]}</h1>

      <section aria-label="Pendências" className="card p-5">
        <h2 className="mb-1 font-semibold">O que precisa de ação</h2>
        {pendentes + solicitacoes + codigosAEnviar.length + pagamentosExpirando.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {pagamentosExpirando.map((p) => (
              <li key={p.id}>
                <Link href={`/reservas/${p.id}`} className="font-medium underline">
                  Pagamento de {p.profissional} vence {p.prazo ? descreverMomento(p.prazo) : 'em breve'}
                </Link>{' '}
                ({descreverPeriodo(p.inicio, p.fim)})
              </li>
            ))}
            {codigosAEnviar.map((c) => (
              <li key={c.id}>
                <Link href={`/reservas/${c.id}`} className="font-medium underline">
                  Enviar código de acesso a {c.profissional}
                </Link>{' '}
                ({descreverPeriodo(c.inicio, c.fim)})
              </li>
            ))}
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
          <p className="text-sm text-zinc-600">Nenhuma pendência no momento.</p>
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

      <Link href={`/agenda?data=${formatarDataISO(hoje)}`} className="inline-block btn btn-primary">
        Abrir a agenda
      </Link>
    </div>
  );
}
