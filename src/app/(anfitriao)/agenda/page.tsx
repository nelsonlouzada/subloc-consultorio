import Link from 'next/link';
import { type DataLocal, diaSemanaDe, formatarDataISO, instanteLocal, parseDataISO, somarDias } from '@/lib/fuso';
import { exigirAnfitriao } from '@/lib/sessao';
import { type ItemAgenda, listarAgenda } from '@/modulos/agenda/bloqueio';
import {
  diasDaSemana,
  hojeLocal,
  horaTexto,
  limitesDoDia,
  nomeDiaCurto,
  nomeMes,
  semanasDoMes,
} from '@/modulos/agenda/calendario';
import { listarReservasNoPeriodo } from '@/modulos/agenda/reserva';
import { carregarSala, horaInteira } from '@/modulos/configuracao/espaco';
import { removerBloqueioAction, removerGrupoAction } from './actions';
import FormularioBloqueio from './FormularioBloqueio';

const ERROS: Record<string, string> = {
  sobreposicao: 'Esse horário já está ocupado. Escolha outro ou remova o bloqueio que está em cima.',
  trava: 'Esse horário cai na hora de intervalo de outro ocupante. Deixe uma hora livre entre eles.',
  dados: 'Confira os campos: o horário final precisa ser depois do inicial.',
  repeticao: 'Na repetição, escolha ao menos um dia da semana e uma data final (até um ano à frente).',
  'sem-sala': 'A sala ainda não foi cadastrada. Rode o seed do espaço.',
};

const TIPO: Record<ItemAgenda['tipo'], { nome: string; cor: string }> = {
  uso_proprio: { nome: 'Uso próprio', cor: 'bg-sky-100 border-sky-400 text-sky-900' },
  indisponivel: { nome: 'Indisponível', cor: 'bg-zinc-200 border-zinc-400 text-zinc-800' },
};

// Reservas: a cor e o texto dizem em que ponto está (a cor sozinha não basta para quem não enxerga cores).
const STATUS_RESERVA: Record<string, { nome: string; cor: string }> = {
  solicitada: { nome: 'Aguardando aprovação', cor: 'bg-amber-100 border-amber-400 text-amber-900' },
  aguardando_pagamento: { nome: 'Aguardando pagamento', cor: 'bg-orange-100 border-orange-400 text-orange-900' },
  confirmada: { nome: 'Confirmada', cor: 'bg-green-100 border-green-500 text-green-900' },
  realizada: { nome: 'Realizada', cor: 'bg-zinc-100 border-zinc-300 text-zinc-700' },
  falta: { nome: 'Falta', cor: 'bg-red-100 border-red-400 text-red-900' },
};

/** O que a agenda desenha: um bloqueio ou uma reserva, já com texto e cor. */
type Linha = {
  id: string;
  inicio: Date;
  fim: Date;
  titulo: string;
  detalhe: string | null;
  cor: string;
  grupoId: string | null;
  bloqueio: boolean;
};

type Busca = { visao?: string; data?: string; aviso?: string; n?: string; conflitos?: string; erro?: string };

function dataDaBusca(texto?: string): DataLocal {
  try {
    return texto ? parseDataISO(texto) : hojeLocal();
  } catch {
    return hojeLocal();
  }
}

const rotuloDia = (d: DataLocal) => `${nomeDiaCurto(d)} ${String(d.dia).padStart(2, '0')}/${String(d.mes).padStart(2, '0')}`;
const link = (visao: string, d: DataLocal) => `/agenda?visao=${visao}&data=${formatarDataISO(d)}`;

function itensDoDia(itens: Linha[], d: DataLocal) {
  const [ini, fim] = limitesDoDia(d);
  return itens.filter((i) => i.inicio < fim && i.fim > ini);
}

export default async function Agenda({ searchParams }: { searchParams: Promise<Busca> }) {
  await exigirAnfitriao();
  const busca = await searchParams;
  const visao = busca.visao === 'mes' ? 'mes' : 'semana';
  const data = dataDaBusca(busca.data);
  const sala = await carregarSala();

  if (!sala) {
    return <p className="rounded-lg bg-amber-50 p-4 text-amber-900">A sala ainda não foi cadastrada. Rode o seed do espaço.</p>;
  }

  const abre = horaInteira(sala.regras.abre);
  const fecha = horaInteira(sala.regras.fecha);
  const funcionamento = sala.regras.diasFuncionamento;

  const semana = diasDaSemana(data);
  const semanasMes = semanasDoMes(data.ano, data.mes);
  const primeiro = visao === 'semana' ? semana[0] : semanasMes[0][0];
  const ultimo = visao === 'semana' ? semana[6] : semanasMes[semanasMes.length - 1][6];
  const de = limitesDoDia(primeiro)[0];
  const ate = limitesDoDia(ultimo)[1];
  const [bloqueios, reservas] = await Promise.all([
    listarAgenda(sala.espaco.id, de, ate),
    listarReservasNoPeriodo(sala.espaco.id, de, ate),
  ]);
  const itens: Linha[] = [
    ...bloqueios.map((b) => ({
      id: b.id,
      inicio: b.inicio,
      fim: b.fim,
      titulo: TIPO[b.tipo].nome,
      detalhe: b.motivo,
      cor: TIPO[b.tipo].cor,
      grupoId: b.grupoId,
      bloqueio: true,
    })),
    ...reservas.map((r) => ({
      id: r.id,
      inicio: r.inicio,
      fim: r.fim,
      titulo: `Reserva · ${STATUS_RESERVA[r.status]?.nome ?? r.status}`,
      detalhe: r.profissional,
      cor: STATUS_RESERVA[r.status]?.cor ?? TIPO.indisponivel.cor,
      grupoId: null,
      bloqueio: false,
    })),
  ].sort((a, b) => a.inicio.getTime() - b.inicio.getTime());

  const anterior = visao === 'semana' ? somarDias(data, -7) : { ano: data.mes === 1 ? data.ano - 1 : data.ano, mes: data.mes === 1 ? 12 : data.mes - 1, dia: 1 };
  const proximo = visao === 'semana' ? somarDias(data, 7) : { ano: data.mes === 12 ? data.ano + 1 : data.ano, mes: data.mes === 12 ? 1 : data.mes + 1, dia: 1 };
  const titulo =
    visao === 'semana'
      ? `${rotuloDia(semana[0])} a ${rotuloDia(semana[6])}`.replace(/^./, (c) => c.toUpperCase())
      : `${nomeMes(data.mes).replace(/^./, (c) => c.toUpperCase())} de ${data.ano}`;

  const hoje = formatarDataISO(hojeLocal());

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Agenda</h1>
        <div className="ml-auto flex flex-wrap items-center gap-2 text-sm">
          <Link href={link('semana', data)} aria-current={visao === 'semana' ? 'page' : undefined} className={`rounded-lg border px-3 py-1.5 ${visao === 'semana' ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white'}`}>
            Semana
          </Link>
          <Link href={link('mes', data)} aria-current={visao === 'mes' ? 'page' : undefined} className={`rounded-lg border px-3 py-1.5 ${visao === 'mes' ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white'}`}>
            Mês
          </Link>
        </div>
      </div>

      {busca.aviso && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
          {busca.aviso === 'criado'
            ? `${busca.n} bloqueio(s) criado(s).`
            : `${busca.n} bloqueio(s) removido(s).`}
          {busca.conflitos && ` Datas puladas por já estarem ocupadas: ${busca.conflitos.split(',').map((c) => c.split('-').reverse().join('/')).join(', ')}.`}
        </p>
      )}
      {busca.erro && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          {ERROS[busca.erro] ?? 'Não foi possível concluir.'}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Link href={link(visao, anterior)} aria-label="Anterior" className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm">
          ←
        </Link>
        <Link href={link(visao, hojeLocal())} className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm">
          Hoje
        </Link>
        <Link href={link(visao, proximo)} aria-label="Próximo" className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm">
          →
        </Link>
        <h2 className="ml-2 text-lg font-medium">{titulo}</h2>
      </div>

      {visao === 'semana' ? (
        <>
          <GradeSemana dias={semana} itens={itens} abre={abre} fecha={fecha} funcionamento={funcionamento} hoje={hoje} />
          <ListaSemana dias={semana} itens={itens} dataAtual={formatarDataISO(data)} />
        </>
      ) : (
        <GradeMes semanas={semanasMes} mes={data.mes} itens={itens} funcionamento={funcionamento} hoje={hoje} />
      )}

      <FormularioBloqueio data={formatarDataISO(data)} abre={abre} fecha={fecha} />
    </div>
  );
}

function GradeSemana({ dias, itens, abre, fecha, funcionamento, hoje }: { dias: DataLocal[]; itens: Linha[]; abre: number; fecha: number; funcionamento: number[]; hoje: string }) {
  const horas = fecha - abre;
  return (
    <section aria-label="Grade da semana" className="hidden overflow-hidden rounded-2xl border border-zinc-200 bg-white md:block">
      <div className="grid grid-cols-[3.5rem_repeat(7,1fr)] border-b border-zinc-200 text-center text-sm">
        <div />
        {dias.map((d) => (
          <div key={formatarDataISO(d)} className={`py-2 ${formatarDataISO(d) === hoje ? 'font-semibold text-sky-800' : ''}`}>
            {rotuloDia(d)}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[3.5rem_repeat(7,1fr)]" style={{ height: `${horas * 2.5}rem` }}>
        <div className="relative text-right text-xs text-zinc-500">
          {Array.from({ length: horas + 1 }, (_, i) => (
            <span key={i} className="absolute right-2 -translate-y-1/2" style={{ top: `${(i / horas) * 100}%` }}>
              {String(abre + i).padStart(2, '0')}h
            </span>
          ))}
        </div>
        {dias.map((d) => {
          const aberto = funcionamento.includes(diaSemanaDe(d));
          const ini = instanteLocal(d.ano, d.mes, d.dia, abre);
          const fim = instanteLocal(d.ano, d.mes, d.dia, fecha);
          return (
            <div
              key={formatarDataISO(d)}
              className={`relative border-l border-zinc-200 ${aberto ? '' : 'bg-zinc-100'}`}
              style={{ backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent calc(100% / ' + horas + ' - 1px), rgb(228 228 231) calc(100% / ' + horas + ' - 1px), rgb(228 228 231) calc(100% / ' + horas + '))' }}
            >
              {!aberto && <span className="absolute inset-x-0 top-2 text-center text-xs text-zinc-500">fechado</span>}
              {itensDoDia(itens, d).map((i) => {
                const s = Math.max(i.inicio.getTime(), ini.getTime());
                const e = Math.min(i.fim.getTime(), fim.getTime());
                if (e <= s) return null;
                const total = fim.getTime() - ini.getTime();
                return (
                  <div
                    key={i.id}
                    title={`${i.titulo}${i.detalhe ? ` — ${i.detalhe}` : ''}`}
                    className={`absolute inset-x-0.5 overflow-hidden rounded border px-1 text-xs ${i.cor}`}
                    style={{ top: `${((s - ini.getTime()) / total) * 100}%`, height: `${((e - s) / total) * 100}%` }}
                  >
                    <strong>{i.titulo}</strong>
                    <br />
                    {horaTexto(i.inicio)}–{horaTexto(i.fim)}
                    {i.detalhe && (
                      <>
                        <br />
                        {i.detalhe}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ListaSemana({ dias, itens, dataAtual }: { dias: DataLocal[]; itens: Linha[]; dataAtual: string }) {
  const comItens = dias.filter((d) => itensDoDia(itens, d).length > 0);
  return (
    <section aria-label="Agenda da semana" className="space-y-3">
      <h3 className="text-base font-semibold">Na semana</h3>
      {comItens.length === 0 && <p className="text-sm text-zinc-600">Nada marcado nesta semana.</p>}
      {comItens.map((d) => (
        <div key={formatarDataISO(d)} className="rounded-xl border border-zinc-200 bg-white p-3">
          <p className="mb-2 text-sm font-medium">{rotuloDia(d)}</p>
          <ul className="space-y-2">
            {itensDoDia(itens, d).map((i) => (
              <li key={i.id} className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm ${i.cor}`}>
                <span>
                  <strong>{i.titulo}</strong> · {horaTexto(i.inicio)}–{horaTexto(i.fim)}
                  {i.detalhe ? ` · ${i.detalhe}` : ''}
                </span>
                <div className="ml-auto flex items-center gap-2">
                  {i.bloqueio && (
                    <form action={removerBloqueioAction}>
                      <input type="hidden" name="id" value={i.id} />
                      <input type="hidden" name="data" value={dataAtual} />
                      <button type="submit" className="rounded border border-current px-2 py-1 text-xs">
                        Remover
                      </button>
                    </form>
                  )}
                  {i.grupoId && (
                    <details className="text-xs">
                      <summary className="cursor-pointer">Parte de uma repetição</summary>
                      <form action={removerGrupoAction} className="mt-1">
                        <input type="hidden" name="grupoId" value={i.grupoId} />
                        <input type="hidden" name="data" value={dataAtual} />
                        <button type="submit" className="rounded border border-red-700 bg-white px-2 py-1 text-red-800">
                          Remover a repetição inteira
                        </button>
                      </form>
                    </details>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function GradeMes({ semanas, mes, itens, funcionamento, hoje }: { semanas: DataLocal[][]; mes: number; itens: Linha[]; funcionamento: number[]; hoje: string }) {
  return (
    <section aria-label="Calendário do mês" className="overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      <div className="grid grid-cols-7 border-b border-zinc-200 text-center text-xs text-zinc-600">
        {['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((n) => (
          <div key={n} className="py-2">
            {n}
          </div>
        ))}
      </div>
      {semanas.map((sem) => (
        <div key={formatarDataISO(sem[0])} className="grid grid-cols-7 border-b border-zinc-100 last:border-0">
          {sem.map((d) => {
            const doDia = itensDoDia(itens, d);
            const aberto = funcionamento.includes(diaSemanaDe(d));
            const iso = formatarDataISO(d);
            return (
              <Link
                key={iso}
                href={link('semana', d)}
                aria-label={`${d.dia} de ${nomeMes(d.mes)}${doDia.length ? `, ${doDia.length} item(ns) na agenda` : ''}`}
                className={`min-h-16 border-l border-zinc-100 p-1.5 text-sm first:border-l-0 ${d.mes !== mes ? 'text-zinc-400' : ''} ${aberto ? '' : 'bg-zinc-50'} ${iso === hoje ? 'ring-2 ring-inset ring-sky-400' : ''}`}
              >
                {d.dia}
                {doDia.length > 0 && (
                  <span className="mt-1 block rounded bg-sky-100 px-1 text-xs text-sky-900">{doDia.length} {doDia.length === 1 ? 'item' : 'itens'}</span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </section>
  );
}
