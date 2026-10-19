import { criarBloqueioAction } from './actions';

const DIAS = [
  [1, 'seg'],
  [2, 'ter'],
  [3, 'qua'],
  [4, 'qui'],
  [5, 'sex'],
  [6, 'sáb'],
  [7, 'dom'],
] as const;

const campo = 'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base';
const rotulo = 'mb-1 block text-sm font-medium';

const horas = (de: number, ate: number) =>
  Array.from({ length: ate - de + 1 }, (_, i) => de + i).map((h) => (
    <option key={h} value={h}>
      {String(h).padStart(2, '0')}:00
    </option>
  ));

export default function FormularioBloqueio({ data, abre, fecha }: { data: string; abre: number; fecha: number }) {
  return (
    <form action={criarBloqueioAction} className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4">
      <h2 className="text-lg font-semibold">Novo bloqueio</h2>

      <fieldset>
        <legend className={rotulo}>Tipo</legend>
        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input type="radio" name="tipo" value="uso_proprio" defaultChecked className="mt-1" />
            <span>
              <strong>Uso próprio</strong> (atendimentos da esposa). Gera a hora de intervalo antes e depois.
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="tipo" value="indisponivel" className="mt-1" />
            <span>
              <strong>Indisponível</strong> (manutenção, feriado, folga). Só fecha o horário, sem intervalo.
            </span>
          </label>
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="data" className={rotulo}>
            Data
          </label>
          <input id="data" name="data" type="date" defaultValue={data} required className={campo} />
        </div>
        <div>
          <label htmlFor="horaInicio" className={rotulo}>
            Das
          </label>
          <select id="horaInicio" name="horaInicio" defaultValue={abre} className={campo}>
            {horas(0, 23)}
          </select>
        </div>
        <div>
          <label htmlFor="horaFim" className={rotulo}>
            Até
          </label>
          <select id="horaFim" name="horaFim" defaultValue={Math.min(abre + 5, fecha)} className={campo}>
            {horas(1, 24)}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="motivo" className={rotulo}>
          Motivo <span className="font-normal text-zinc-500">(opcional)</span>
        </label>
        <input id="motivo" name="motivo" type="text" maxLength={200} className={campo} />
      </div>

      <div>
        <input type="checkbox" id="repetir" name="repetir" className="peer mr-2" />
        <label htmlFor="repetir" className="text-sm font-medium">
          Repetir
        </label>
        <div className="mt-3 hidden space-y-3 peer-checked:block">
          <fieldset>
            <legend className={rotulo}>Nos dias</legend>
            <div className="flex flex-wrap gap-3 text-sm">
              {DIAS.map(([n, nome]) => (
                <label key={n} className="flex items-center gap-1">
                  <input type="checkbox" name="dias" value={n} aria-label={nome} /> {nome}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="sm:w-1/3">
            <label htmlFor="ate" className={rotulo}>
              Até a data
            </label>
            <input id="ate" name="ate" type="date" className={campo} />
          </div>
          <p className="text-xs text-zinc-600">
            Datas que já estiverem ocupadas são puladas e avisadas depois; as demais são criadas.
          </p>
        </div>
      </div>

      <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white">
        Criar bloqueio
      </button>
    </form>
  );
}
