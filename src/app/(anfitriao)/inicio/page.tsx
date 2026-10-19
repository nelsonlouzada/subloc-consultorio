import Link from 'next/link';
import { exigirAnfitriao } from '@/lib/sessao';
import { somarDias, formatarDataISO, type DataLocal } from '@/lib/fuso';
import { listarAgenda } from '@/modulos/agenda/bloqueio';
import { hojeLocal, horaTexto, limitesDoDia, nomeDiaCurto } from '@/modulos/agenda/calendario';
import { carregarSala } from '@/modulos/configuracao/espaco';

const TIPO = { uso_proprio: 'Uso próprio', indisponivel: 'Indisponível' } as const;

async function Dia({ titulo, d, espacoId }: { titulo: string; d: DataLocal; espacoId: string }) {
  const [ini, fim] = limitesDoDia(d);
  const itens = await listarAgenda(espacoId, ini, fim);
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
              <strong>{horaTexto(i.inicio)}–{horaTexto(i.fim)}</strong> · {TIPO[i.tipo]}
              {i.motivo ? ` · ${i.motivo}` : ''}
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

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Olá, {sessao.user.name.split(' ')[0]}</h1>

      <section aria-label="Pendências" className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="mb-1 font-semibold">O que precisa de ação</h2>
        <p className="text-sm text-zinc-600">
          Nenhuma pendência. Cadastros para aprovar, solicitações de reserva, códigos de acesso a enviar e pagamentos
          prestes a expirar aparecem aqui a partir da próxima etapa.
        </p>
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
