import { formatarReais } from '@/lib/dinheiro';
import { exigirAnfitriao } from '@/lib/sessao';
import { descreverMomento } from '@/modulos/agenda/calendario';
import { carregarSala } from '@/modulos/configuracao/espaco';
import { carregarPrecosParaTela, TEXTO_ERRO_TABELA, type ItemPreco } from '@/modulos/configuracao/tabela';
import { salvarPrecosAction } from './actions';

export const metadata = { title: 'Preços' };

const AVISOS: Record<string, string> = {
  salvo: 'Preços salvos. Valem a partir de agora; reservas já feitas mantêm o valor da época.',
  agendado: 'Preços agendados. Até a data de início, continuam valendo os de hoje.',
  sem_mudanca: 'Nada mudou.',
};
const reais = (c: number) => (c / 100).toFixed(2).replace('.', ',');
const campo = 'w-32 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base';

function Preco({ nome, item }: { nome: string; item: ItemPreco }) {
  return (
    <div>
      <label htmlFor={nome} className="mb-1 block text-sm font-medium">
        {item.nome}
      </label>
      <div className="flex items-center gap-2">
        <span className="text-sm text-zinc-700">R$</span>
        <input id={nome} name={nome} inputMode="decimal" required defaultValue={reais(item.agendado?.centavos ?? item.vigenteCentavos)} className={campo} />
      </div>
      {item.agendado ? (
        <p className="mt-1 text-xs text-zinc-700">
          Hoje: {formatarReais(item.vigenteCentavos)}. Muda para {formatarReais(item.agendado.centavos)} em {descreverMomento(item.agendado.desde)}.
        </p>
      ) : (
        <p className="mt-1 text-xs text-zinc-600">Hoje: {formatarReais(item.vigenteCentavos)}</p>
      )}
    </div>
  );
}

export default async function Precos({ searchParams }: { searchParams: Promise<{ aviso?: string; erro?: string }> }) {
  await exigirAnfitriao();
  const { aviso, erro } = await searchParams;
  const sala = await carregarSala();
  if (!sala) return <p className="rounded-lg bg-amber-50 p-4 text-amber-900">A sala ainda não foi cadastrada.</p>;
  const p = await carregarPrecosParaTela(sala.espaco.id);

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-700">
        O profissional paga o menor valor entre as horas avulsas, o turno e o dia inteiro. Cada reserva guarda o preço da época em que foi feita, então mudar aqui não altera o que já foi reservado.
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

      <form action={salvarPrecosAction} className="space-y-6">
        <fieldset className="card space-y-4 p-5">
          <legend className="px-1 text-lg font-semibold">Valores</legend>
          <div className="flex flex-wrap gap-6">
            <Preco nome="hora" item={p.hora} />
            {p.turnos.map((t) => (
              <Preco key={t.turnoId} nome={`turno:${t.turnoId}`} item={t} />
            ))}
            <Preco nome="dia" item={p.dia} />
          </div>
        </fieldset>

        <fieldset className="card space-y-2 p-5">
          <legend className="px-1 text-lg font-semibold">Quando passam a valer</legend>
          <label htmlFor="desde" className="block text-sm">
            A partir de (deixe em branco para valer agora)
          </label>
          <input id="desde" name="desde" type="date" className={campo} />
        </fieldset>

        <button type="submit" className="btn btn-primary">
          Salvar os preços
        </button>
      </form>
    </div>
  );
}
