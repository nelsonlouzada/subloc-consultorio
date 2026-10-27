import { exigirAnfitriao } from '@/lib/sessao';
import { carregarSala } from '@/modulos/configuracao/espaco';
import { carregarTurnosParaTela, TEXTO_ERRO_TABELA } from '@/modulos/configuracao/tabela';
import { salvarTurnosAction } from './actions';

export const metadata = { title: 'Turnos' };

const AVISOS: Record<string, string> = {
  salvo: 'Turnos salvos. Valem para os próximos pedidos; reservas já feitas não mudam.',
  sem_mudanca: 'Nada mudou.',
};
const campo = 'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base';

function Campo({ id, rotulo, children }: { id: string; rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {rotulo}
      </label>
      {children}
    </div>
  );
}

export default async function Turnos({ searchParams }: { searchParams: Promise<{ aviso?: string; erro?: string }> }) {
  await exigirAnfitriao();
  const { aviso, erro } = await searchParams;
  const sala = await carregarSala();
  if (!sala) return <p className="rounded-lg bg-amber-50 p-4 text-amber-900">A sala ainda não foi cadastrada.</p>;
  const turnos = await carregarTurnosParaTela(sala.espaco.id);

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-700">
        Turnos são faixas de horário com preço próprio. Um turno que deixa de existir é desativado, não apagado, porque reservas antigas apontam para ele. Os horários são em horas cheias e ficam dentro do funcionamento da sala.
      </p>

      {aviso && AVISOS[aviso] && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
          {AVISOS[aviso]}
        </p>
      )}
      {erro && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          {TEXTO_ERRO_TABELA[erro] ?? TEXTO_ERRO_TABELA.invalido}
        </p>
      )}

      <form action={salvarTurnosAction} className="space-y-6">
        <fieldset className="card space-y-4 p-5">
          <legend className="px-1 text-lg font-semibold">Turnos da sala</legend>
          {turnos.map((t) => (
            <div key={t.id} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="id" value={t.id} />
              <Campo id={`nome:${t.id}`} rotulo="Nome">
                <input id={`nome:${t.id}`} name={`nome:${t.id}`} required maxLength={40} defaultValue={t.nome} className={`${campo} w-44`} />
              </Campo>
              <Campo id={`inicio:${t.id}`} rotulo="Das (h)">
                <input id={`inicio:${t.id}`} name={`inicio:${t.id}`} type="number" min={0} max={23} required defaultValue={t.inicio} className={`${campo} w-20`} />
              </Campo>
              <Campo id={`fim:${t.id}`} rotulo="Às (h)">
                <input id={`fim:${t.id}`} name={`fim:${t.id}`} type="number" min={1} max={24} required defaultValue={t.fim} className={`${campo} w-20`} />
              </Campo>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" name={`ativo:${t.id}`} defaultChecked={t.ativo} />
                Ativo
              </label>
            </div>
          ))}
        </fieldset>

        <fieldset className="card space-y-4 p-5">
          <legend className="px-1 text-lg font-semibold">Novo turno (opcional)</legend>
          <div className="flex flex-wrap items-end gap-3">
            <Campo id="novoNome" rotulo="Nome">
              <input id="novoNome" name="novoNome" maxLength={40} className={`${campo} w-44`} />
            </Campo>
            <Campo id="novoInicio" rotulo="Das (h)">
              <input id="novoInicio" name="novoInicio" type="number" min={0} max={23} className={`${campo} w-20`} />
            </Campo>
            <Campo id="novoFim" rotulo="Às (h)">
              <input id="novoFim" name="novoFim" type="number" min={1} max={24} className={`${campo} w-20`} />
            </Campo>
            <Campo id="novoValor" rotulo="Preço (R$)">
              <input id="novoValor" name="novoValor" inputMode="decimal" className={`${campo} w-28`} />
            </Campo>
          </div>
        </fieldset>

        <button type="submit" className="btn btn-primary">
          Salvar os turnos
        </button>
      </form>
    </div>
  );
}
