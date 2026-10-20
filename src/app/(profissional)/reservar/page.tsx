import Link from 'next/link';
import { type DataLocal, formatarDataISO, somarDias } from '@/lib/fuso';
import { formatarReais } from '@/lib/dinheiro';
import { exigirProfissional } from '@/lib/sessao';
import { descreverPeriodo, diasDaSemana, hojeLocal, nomeDiaCurto } from '@/modulos/agenda/calendario';
import { TEXTO_MOTIVO } from '@/modulos/agenda/disponibilidade';
import { opcoesDoDia } from '@/modulos/agenda/opcoes';
import { listarReservasDoProfissional, TEXTO_ERRO_RESERVA, type ErroReserva } from '@/modulos/agenda/reserva';
import { carregarSala } from '@/modulos/configuracao/espaco';
import { dataValida } from './pedido';

export const metadata = { title: 'Reservar a sala' };

type Busca = { data?: string; modo?: string; de?: string; aviso?: string; erro?: string };

const STATUS: Record<string, { nome: string; cor: string }> = {
  solicitada: { nome: 'Aguardando aprovação', cor: 'bg-amber-100 text-amber-900' },
  aguardando_pagamento: { nome: 'Aprovada, aguardando pagamento', cor: 'bg-orange-100 text-orange-900' },
  confirmada: { nome: 'Confirmada', cor: 'bg-green-100 text-green-900' },
  realizada: { nome: 'Realizada', cor: 'bg-zinc-100 text-zinc-700' },
  falta: { nome: 'Falta', cor: 'bg-red-100 text-red-900' },
  recusada: { nome: 'Recusada', cor: 'bg-red-100 text-red-900' },
  expirada: { nome: 'Expirada', cor: 'bg-zinc-100 text-zinc-700' },
  cancelada: { nome: 'Cancelada', cor: 'bg-zinc-100 text-zinc-700' },
};

const MODOS = [
  { chave: 'turno', nome: 'Turno' },
  { chave: 'hora', nome: 'Hora' },
  { chave: 'dia', nome: 'Dia inteiro' },
] as const;

const rotuloDia = (d: DataLocal) => `${nomeDiaCurto(d)} ${String(d.dia).padStart(2, '0')}/${String(d.mes).padStart(2, '0')}`;
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const linkReservar = (d: DataLocal, modo: string, extra = '') => `/reservar?data=${formatarDataISO(d)}&modo=${modo}${extra}`;
const linkResumo = (d: DataLocal, params: string) => `/reservar/resumo?data=${formatarDataISO(d)}&${params}`;

const botaoOk = 'rounded-lg border border-zinc-900 bg-white px-3 py-2 text-sm hover:bg-zinc-900 hover:text-white';
const botaoOff = 'cursor-not-allowed rounded-lg border border-zinc-200 bg-zinc-100 px-3 py-2 text-sm text-zinc-400';

export default async function Reservar({ searchParams }: { searchParams: Promise<Busca> }) {
  const { sessao, profissional } = await exigirProfissional();
  const busca = await searchParams;
  const sala = await carregarSala();
  const hoje = hojeLocal();
  const data = dataValida(busca.data) ?? somarDias(hoje, 1);
  const modo = MODOS.find((m) => m.chave === busca.modo)?.chave ?? 'turno';
  const podePedir = profissional.status === 'pendente' || profissional.status === 'aprovado';

  const [opcoes, meus] = await Promise.all([
    sala && podePedir ? opcoesDoDia(sala.espaco.id, sessao.user.id, data) : null,
    listarReservasDoProfissional(sessao.user.id),
  ]);
  const semana = diasDaSemana(data);
  const de = /^\d{1,2}$/.test(busca.de ?? '') ? Number(busca.de) : null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Reservar a sala</h1>

      {busca.aviso === 'pedido_enviado' && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
          Pedido enviado. O horário está retido para você. Os responsáveis pela sala vão responder em breve, e você será avisado por e-mail.
        </p>
      )}
      {busca.erro && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          {TEXTO_ERRO_RESERVA[busca.erro as ErroReserva] ?? 'Não foi possível concluir o pedido.'}
        </p>
      )}

      {!sala ? (
        <p className="rounded-lg bg-amber-50 p-4 text-amber-900">A sala ainda não está configurada.</p>
      ) : !podePedir ? (
        <p className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
          No momento não é possível fazer novas reservas com este cadastro.
        </p>
      ) : (
        opcoes && (
          <>
            <section aria-label="Escolha o dia" className="space-y-2">
              <div className="flex items-center gap-2">
                <Link href={linkReservar(somarDias(data, -7), modo)} aria-label="Semana anterior" className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm">
                  ←
                </Link>
                <Link href={linkReservar(somarDias(data, 7), modo)} aria-label="Próxima semana" className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm">
                  →
                </Link>
                <span className="text-sm text-zinc-600">{rotuloDia(semana[0])} a {rotuloDia(semana[6])}</span>
              </div>
              <ul className="grid grid-cols-7 gap-1 text-center text-xs">
                {semana.map((d) => {
                  const iso = formatarDataISO(d);
                  const atual = iso === formatarDataISO(data);
                  const passado = iso < formatarDataISO(hoje);
                  const aberto = sala.regras.diasFuncionamento.includes(semana.indexOf(d) + 1);
                  const livre = !passado && aberto;
                  const classe = `block rounded-lg border px-1 py-2 ${atual ? 'border-zinc-900 bg-zinc-900 text-white' : livre ? 'border-zinc-300 bg-white' : 'border-zinc-200 bg-zinc-100 text-zinc-400'}`;
                  return (
                    <li key={iso}>
                      {livre ? (
                        <Link href={linkReservar(d, modo)} aria-current={atual ? 'date' : undefined} className={classe}>
                          {nomeDiaCurto(d)}
                          <br />
                          <strong>{String(d.dia).padStart(2, '0')}</strong>
                        </Link>
                      ) : (
                        <span aria-disabled="true" title={passado ? 'Data passada' : 'A sala não abre neste dia'} className={classe}>
                          {nomeDiaCurto(d)}
                          <br />
                          <strong>{String(d.dia).padStart(2, '0')}</strong>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            <nav aria-label="Como reservar" className="flex gap-2 text-sm">
              {MODOS.map((m) => (
                <Link key={m.chave} href={linkReservar(data, m.chave)} aria-current={m.chave === modo ? 'page' : undefined} className={`rounded-lg border px-3 py-1.5 ${m.chave === modo ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white'}`}>
                  {m.nome}
                </Link>
              ))}
            </nav>

            <section aria-label="Horários" className="rounded-2xl border border-zinc-200 bg-white p-4">
              {!opcoes.aberto ? (
                <p className="text-sm text-zinc-600">A sala não abre neste dia.</p>
              ) : modo === 'turno' ? (
                <ul className="space-y-3">
                  {opcoes.turnos.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center gap-3">
                      <div>
                        <strong>{t.nome}</strong> · {hh(t.inicio)} às {hh(t.fim)}
                        <div className="text-sm text-zinc-600">{formatarReais(t.centavos)}</div>
                      </div>
                      {t.motivo === null ? (
                        <Link href={linkResumo(data, `unidade=turno&turno=${t.id}`)} className={`ml-auto ${botaoOk}`}>
                          Escolher
                        </Link>
                      ) : (
                        <span className={`ml-auto ${botaoOff}`} aria-disabled="true">
                          Indisponível
                          <span className="sr-only">: {TEXTO_MOTIVO[t.motivo]}</span>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : modo === 'dia' ? (
                <div className="flex flex-wrap items-center gap-3">
                  <div>
                    <strong>Dia inteiro</strong> · {hh(opcoes.diaInteiro.inicio)} às {hh(opcoes.diaInteiro.fim)}
                    <div className="text-sm text-zinc-600">{formatarReais(opcoes.diaInteiro.centavos)}</div>
                  </div>
                  {opcoes.diaInteiro.motivo === null ? (
                    <Link href={linkResumo(data, 'unidade=dia')} className={`ml-auto ${botaoOk}`}>
                      Escolher
                    </Link>
                  ) : (
                    <span className={`ml-auto ${botaoOff}`} aria-disabled="true">
                      Indisponível
                      <span className="sr-only">: {TEXTO_MOTIVO[opcoes.diaInteiro.motivo]}</span>
                    </span>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <h2 className="mb-2 text-sm font-medium">1. Hora de início ({formatarReais(opcoes.horaCentavos)} por hora, a partir de)</h2>
                    <ul className="flex flex-wrap gap-2">
                      {opcoes.horas.map(({ hora, motivo }) => (
                        <li key={hora}>
                          {motivo === null ? (
                            <Link href={linkReservar(data, 'hora', `&de=${hora}`)} aria-current={de === hora ? 'true' : undefined} className={de === hora ? 'rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-2 text-sm text-white' : botaoOk}>
                              {hh(hora)}
                            </Link>
                          ) : (
                            <span aria-disabled="true" title={TEXTO_MOTIVO[motivo]} className={botaoOff}>
                              {hh(hora)}
                              <span className="sr-only"> indisponível: {TEXTO_MOTIVO[motivo]}</span>
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {de !== null && opcoes.fimsPorInicio[de] && (
                    <div>
                      <h2 className="mb-2 text-sm font-medium">2. Hora final (começando às {hh(de)})</h2>
                      <ul className="flex flex-wrap gap-2">
                        {opcoes.fimsPorInicio[de].map((fim) => (
                          <li key={fim}>
                            <Link href={linkResumo(data, `unidade=hora&de=${de}&ate=${fim}`)} className={botaoOk}>
                              {hh(fim)}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </section>
          </>
        )
      )}

      <section aria-label="Meus pedidos" className="space-y-3">
        <h2 className="text-lg font-semibold">Meus pedidos</h2>
        {meus.length === 0 ? (
          <p className="text-sm text-zinc-600">Você ainda não fez nenhum pedido.</p>
        ) : (
          <ul className="space-y-2">
            {meus.map((r) => {
              const s = STATUS[r.status] ?? { nome: r.status, cor: 'bg-zinc-100 text-zinc-700' };
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-200 bg-white p-3 text-sm">
                  <span>{descreverPeriodo(r.inicio, r.fim)}</span>
                  <span className="text-zinc-600">{formatarReais(r.valorCentavos)}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${s.cor}`}>{s.nome}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
