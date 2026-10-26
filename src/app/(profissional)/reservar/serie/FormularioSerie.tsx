'use client';

import { useState } from 'react';

type Turno = { id: string; nome: string; inicio: number; fim: number };
type Valores = {
  dias: string[];
  freq: string;
  unidade: string;
  turno: string;
  de: string;
  ate: string;
  inicio: string;
  fim: string;
  pag: string;
};

const DIAS = [
  { n: 1, nome: 'Segunda' },
  { n: 2, nome: 'Terça' },
  { n: 3, nome: 'Quarta' },
  { n: 4, nome: 'Quinta' },
  { n: 5, nome: 'Sexta' },
  { n: 6, nome: 'Sábado' },
  { n: 7, nome: 'Domingo' },
];

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const campo = 'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base';

export default function FormularioSerie({
  turnos,
  diasAbertos,
  abre,
  fecha,
  minData,
  maxData,
  descontoPct,
  valores,
  renovacaoDe,
}: {
  turnos: Turno[];
  diasAbertos: number[];
  abre: number;
  fecha: number;
  minData: string;
  maxData: string;
  descontoPct: number;
  valores: Valores;
  renovacaoDe?: string;
}) {
  const [unidade, setUnidade] = useState(valores.unidade || 'turno');
  const horas = Array.from({ length: fecha - abre + 1 }, (_, i) => abre + i);

  return (
    <form action="/reservar/serie/resumo" method="get" className="space-y-6 rounded-2xl border border-zinc-200 bg-white p-5">
      {renovacaoDe && <input type="hidden" name="renovacaoDe" value={renovacaoDe} />}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">1. Em quais dias da semana?</legend>
        <div className="flex flex-wrap gap-2">
          {DIAS.map((d) => {
            const aberto = diasAbertos.includes(d.n);
            return (
              <label
                key={d.n}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${aberto ? 'border-zinc-300 bg-white' : 'border-zinc-200 bg-zinc-100 text-zinc-500'}`}
              >
                <input type="checkbox" name="dias" value={d.n} defaultChecked={valores.dias.includes(String(d.n))} disabled={!aberto} />
                {d.nome}
              </label>
            );
          })}
        </div>
        <p className="text-xs text-zinc-600">Dias em cinza: a sala não abre.</p>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">2. Com que frequência?</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="freq" value="semanal" defaultChecked={valores.freq !== 'quinzenal'} /> Toda semana
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="freq" value="quinzenal" defaultChecked={valores.freq === 'quinzenal'} /> A cada duas semanas
          </label>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">3. Qual horário?</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          {[
            ['turno', 'Turno'],
            ['hora', 'Por hora'],
            ['dia', 'Dia inteiro'],
          ].map(([v, nome]) => (
            <label key={v} className="flex items-center gap-2">
              <input type="radio" name="unidade" value={v} checked={unidade === v} onChange={() => setUnidade(v)} /> {nome}
            </label>
          ))}
        </div>
        {unidade === 'turno' && (
          <div>
            <label htmlFor="turno" className="mb-1 block text-sm">
              Turno
            </label>
            <select id="turno" name="turno" defaultValue={valores.turno} className={campo}>
              {turnos.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome} · {hh(t.inicio)} às {hh(t.fim)}
                </option>
              ))}
            </select>
          </div>
        )}
        {unidade === 'hora' && (
          <div className="flex flex-wrap gap-3">
            <div>
              <label htmlFor="de" className="mb-1 block text-sm">
                Das
              </label>
              <select id="de" name="de" defaultValue={valores.de || String(abre + 2)} className={campo}>
                {horas.slice(0, -1).map((h) => (
                  <option key={h} value={h}>
                    {hh(h)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ate" className="mb-1 block text-sm">
                Até
              </label>
              <select id="ate" name="ate" defaultValue={valores.ate || String(abre + 3)} className={campo}>
                {horas.slice(1).map((h) => (
                  <option key={h} value={h}>
                    {hh(h)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        {unidade === 'dia' && <p className="text-sm text-zinc-700">Das {hh(abre)} às {hh(fecha)}, no dia inteiro.</p>}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">4. Por quanto tempo?</legend>
        <div className="flex flex-wrap gap-3">
          <div>
            <label htmlFor="inicio" className="mb-1 block text-sm">
              A partir de
            </label>
            <input id="inicio" name="inicio" type="date" required min={minData} max={maxData} defaultValue={valores.inicio || minData} className={campo} />
          </div>
          <div>
            <label htmlFor="fim" className="mb-1 block text-sm">
              Até
            </label>
            <input id="fim" name="fim" type="date" required min={minData} max={maxData} defaultValue={valores.fim} className={campo} />
          </div>
        </div>
        <p className="text-xs text-zinc-600">A série vai até 60 dias à frente. Perto do fim você recebe um aviso para renová-la.</p>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">5. Como prefere pagar?</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="pag" value="pacote_mes" defaultChecked={valores.pag !== 'por_ocorrencia'} className="mt-1" />
          <span>
            <strong>Pacote do mês{descontoPct > 0 ? `, com ${descontoPct}% de desconto` : ''}.</strong> Um pagamento por mês cobre todas as datas dele.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" name="pag" value="por_ocorrencia" defaultChecked={valores.pag === 'por_ocorrencia'} className="mt-1" />
          <span>
            <strong>Por data.</strong> Você recebe um link de pagamento alguns dias antes de cada data, sem desconto.
          </span>
        </label>
      </fieldset>

      <button type="submit" className="w-full rounded-lg bg-zinc-900 px-4 py-3 font-medium text-white">
        Ver as datas e o valor
      </button>
    </form>
  );
}
