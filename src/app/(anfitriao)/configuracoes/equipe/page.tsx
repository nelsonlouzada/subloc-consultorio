import { exigirAnfitriao } from '@/lib/sessao';
import { descreverMomento } from '@/modulos/agenda/calendario';
import { listarAnfitrioes } from '@/modulos/configuracao/pagamento';

export const metadata = { title: 'Anfitriões' };

export default async function Anfitrioes() {
  const sessao = await exigirAnfitriao();
  const contas = await listarAnfitrioes();

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-700">
        Quem tem acesso a este painel. Todos têm as mesmas permissões, e cada ação fica registrada com o nome de quem fez. Por segurança, contas de Anfitrião são criadas por quem cuida do sistema, nunca por formulário.
      </p>
      <section aria-label="Anfitriões" className="card p-5">
        <ul className="divide-y divide-zinc-200 text-sm">
          {contas.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
              <strong className="font-medium">{c.nome}</strong>
              <span className="text-zinc-700">{c.email}</span>
              {c.id === sessao.user.id && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-900">você</span>}
              {!c.emailVerificado && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">e-mail não confirmado</span>}
              <span className="ml-auto text-zinc-600">desde {descreverMomento(c.criadoEm)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
