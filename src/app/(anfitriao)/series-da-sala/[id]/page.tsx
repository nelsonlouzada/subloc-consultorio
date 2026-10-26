import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { formatarReais } from '@/lib/dinheiro';
import { exigirAnfitriao } from '@/lib/sessao';
import { listarAuditoriaDe } from '@/modulos/auditoria/auditoria';
import { descreverMomento, descreverPeriodo } from '@/modulos/agenda/calendario';
import { ROTULO_STATUS } from '@/modulos/agenda/consulta';
import { obterSerie, ROTULO_SERIE } from '@/modulos/agenda/serie-consulta';
import { aprovarSerieAction, cancelarSerieAnfitriaoAction, marcarPagoSerieAction, recusarSerieAction } from '../actions';

export const metadata = { title: 'Série' };

const AVISOS: Record<string, string> = {
  aprovada: 'Série aprovada. As cobranças saem conforme a forma de pagamento escolhida, e o profissional foi avisado por e-mail.',
  recusada: 'Série recusada e horários liberados. O profissional foi avisado por e-mail.',
  pago: 'Pagamento registrado. As datas dessa cobrança estão confirmadas e o profissional foi avisado por e-mail.',
  pago_credito: 'Pagamento registrado. Algumas datas já não estavam livres: o valor delas virou crédito na carteira do profissional.',
  cancelada: 'Série cancelada e horários liberados. O profissional foi avisado por e-mail.',
  cancelada_credito: 'Série cancelada e horários liberados. As datas já pagas viraram crédito integral na carteira do profissional.',
};
const ERROS: Record<string, string> = {
  prazo: 'O prazo para aprovar esta série já passou. Os horários serão liberados automaticamente.',
  cadastro: 'O cadastro deste profissional ainda não foi aprovado. Use "Aprovar cadastro e série".',
  estado: 'O estado desta série mudou. Confira abaixo e tente de novo.',
};
const NOME_ACAO: Record<string, string> = {
  serie_solicitada: 'Série pedida',
  serie_aprovada: 'Série aprovada',
  serie_recusada: 'Série recusada',
  serie_cancelada: 'Série cancelada pelos responsáveis',
  serie_cancelada_profissional: 'Série cancelada pelo profissional',
  cobranca_serie_gerada: 'Cobrança gerada',
  pagamento_serie_marcado: 'Pagamento marcado como recebido',
  pagamento_serie_atrasado: 'Pagamento recebido depois do prazo',
};
const botao = 'rounded-lg px-4 py-2.5 font-medium';

export default async function SerieDoAnfitriao({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aviso?: string; erro?: string }>;
}) {
  await exigirAnfitriao();
  const { id } = await params;
  const { aviso, erro } = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const dados = await obterSerie(id);
  if (!dados) notFound();

  const { serie, reservas, cobrancas, descricao, profissionalNome, profissionalEmail, profissionalStatus } = dados;
  const historico = await listarAuditoriaDe('serie', id);
  const rotulo = ROTULO_SERIE[serie.status] ?? { nome: serie.status, cor: 'bg-zinc-100 text-zinc-700' };
  const pendente = profissionalStatus === 'pendente';
  const reservaPorId = new Map(reservas.map((r) => [r.id, r]));
  const total = reservas.filter((r) => ['solicitada', 'aprovada', 'aguardando_pagamento', 'confirmada'].includes(r.status)).reduce((s, r) => s + r.valorCentavos, 0);
  const prazoDecisao = reservas.filter((r) => r.status === 'solicitada').map((r) => r.prazoAprovacaoAte?.getTime()).filter((t): t is number => Boolean(t));

  return (
    <div className="space-y-5">
      <Link href="/solicitacoes" className="inline-block py-1 text-sm underline">
        ← Solicitações
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{descricao}</h1>
        <span className={`rounded-full px-2 py-0.5 text-xs ${rotulo.cor}`}>{rotulo.nome}</span>
      </div>

      {aviso && AVISOS[aviso] && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
          {AVISOS[aviso]}
        </p>
      )}
      {erro && ERROS[erro] && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          {ERROS[erro]}
        </p>
      )}

      <section className="space-y-1 rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
        <p>
          <span className="text-zinc-500">Profissional:</span>{' '}
          <Link href={`/profissionais/${encodeURIComponent(serie.profissionalId)}`} className="underline">
            {profissionalNome}
          </Link>{' '}
          · {profissionalEmail}
          {pendente && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">Cadastro pendente</span>}
        </p>
        <p>
          <span className="text-zinc-500">Pagamento:</span> {serie.formaPagamento === 'pacote_mes' ? 'pacote do mês (com desconto)' : 'por data'} · total das datas ativas {formatarReais(total)}
        </p>
        <p>
          <span className="text-zinc-500">Pedido em:</span> {descreverMomento(serie.criadoEm)}
          {serie.motivoRecusa && (
            <>
              {' · '}
              <span className="text-zinc-500">motivo da recusa:</span> {serie.motivoRecusa}
            </>
          )}
        </p>
      </section>

      {serie.status === 'solicitada' && (
        <section className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4">
          <h2 className="font-semibold">Decisão</h2>
          {prazoDecisao.length > 0 && (
            <p className="text-sm text-zinc-600">
              Responder até <strong>{descreverMomento(new Date(Math.min(...prazoDecisao)))}</strong> (depois disso os horários são liberados)
            </p>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <form action={aprovarSerieAction}>
              <input type="hidden" name="id" value={serie.id} />
              {pendente && <input type="hidden" name="aprovarCadastro" value="on" />}
              <button type="submit" className={`${botao} bg-zinc-900 text-white`}>
                {pendente ? 'Aprovar cadastro e série' : 'Aprovar a série inteira'}
              </button>
            </form>
            <form action={recusarSerieAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={serie.id} />
              <div>
                <label htmlFor="motivo-recusa" className="block text-xs text-zinc-600">
                  Motivo da recusa (opcional)
                </label>
                <input id="motivo-recusa" name="motivo" maxLength={300} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm" />
              </div>
              <button type="submit" className={`${botao} border border-red-700 bg-white text-red-800 hover:bg-red-700 hover:text-white`}>
                Recusar a série
              </button>
            </form>
          </div>
        </section>
      )}

      {cobrancas.length > 0 && (
        <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
          <h2 className="font-semibold">Cobranças</h2>
          {cobrancas.map(({ cobranca, reservaIds }) => (
            <div key={cobranca.id} className="space-y-1 border-t border-zinc-100 pt-3 first:border-0 first:pt-0">
              <p>
                {cobranca.finalidade === 'pacote_mes' ? 'Pacote do mês' : 'Data avulsa da série'} · {formatarReais(cobranca.valorCobradoCentavos)} · cobrança {cobranca.status}
                {cobranca.meio === 'pix_manual' && ' · Pix conferido manualmente'}
                {cobranca.meio === 'credito' && ' · paga com crédito'}
                {cobranca.creditoUsadoCentavos > 0 && cobranca.meio !== 'credito' && ` · abatido ${formatarReais(cobranca.creditoUsadoCentavos)} de crédito`}
              </p>
              <ul className="list-disc pl-5 text-zinc-700">
                {reservaIds.map((rid) => {
                  const r = reservaPorId.get(rid);
                  return r ? <li key={rid}>{descreverPeriodo(r.inicio, r.fim)}</li> : null;
                })}
              </ul>
              {cobranca.status === 'pendente' && cobranca.venceEm && (
                <p>
                  Pagar até <strong>{descreverMomento(cobranca.venceEm)}</strong>. Sem pagamento até lá, essas datas são liberadas.
                </p>
              )}
              {cobranca.status === 'expirada' && <p className="text-amber-900">O prazo venceu. Se o Pix chegou mesmo assim, marque abaixo: as datas ainda livres voltam e as demais viram crédito.</p>}
              {(cobranca.status === 'pendente' || cobranca.status === 'expirada') && (
                <form action={marcarPagoSerieAction}>
                  <input type="hidden" name="id" value={serie.id} />
                  <input type="hidden" name="cobrancaId" value={cobranca.id} />
                  <button type="submit" className={`${botao} bg-zinc-900 text-white`}>
                    Marcar pagamento como recebido
                  </button>
                  <p className="mt-1 text-xs text-zinc-600">Confira o Pix no seu banco antes de marcar. Vale para todas as datas desta cobrança.</p>
                </form>
              )}
            </div>
          ))}
        </section>
      )}

      <section aria-label="Datas" className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
        <h2 className="font-semibold">As datas</h2>
        <ul className="space-y-1">
          {reservas.map((r) => {
            const s = ROTULO_STATUS[r.status] ?? { nome: r.status, cor: 'bg-zinc-100 text-zinc-700' };
            return (
              <li key={r.id}>
                <Link href={`/reservas/${r.id}`} className="flex flex-wrap items-center gap-2 py-1 hover:underline">
                  <span>{descreverPeriodo(r.inicio, r.fim)}</span>
                  <span className="text-zinc-600">{formatarReais(r.valorCentavos)}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${s.cor}`}>{s.nome}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {(serie.status === 'solicitada' || serie.status === 'aprovada') && (
        <section className="space-y-3 rounded-2xl border border-red-200 bg-white p-4 text-sm">
          <h2 className="font-semibold">Cancelar a série</h2>
          <p className="text-zinc-700">
            Cancela todas as datas que ainda não começaram, libera os horários e avisa o profissional. Datas já pagas voltam como crédito <strong>integral</strong> na carteira dele. Para cancelar
            uma data só, abra-a na lista acima.
          </p>
          <form action={cancelarSerieAnfitriaoAction}>
            <input type="hidden" name="id" value={serie.id} />
            <button type="submit" className={`${botao} border border-red-700 bg-white text-red-800 hover:bg-red-700 hover:text-white`}>
              Cancelar a série inteira
            </button>
          </form>
        </section>
      )}

      <section aria-label="Histórico" className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">Histórico</h2>
        {historico.length === 0 ? (
          <p className="text-sm text-zinc-600">Sem registros.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {historico.map((h, i) => (
              <li key={i}>
                {descreverMomento(h.quando)} · {NOME_ACAO[h.acao] ?? h.acao}
                {h.quem ? ` por ${h.quem}` : ' (automático)'}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
