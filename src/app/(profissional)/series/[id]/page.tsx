import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { formatarReais } from '@/lib/dinheiro';
import { exigirProfissional } from '@/lib/sessao';
import { descreverMomento, descreverPeriodo } from '@/modulos/agenda/calendario';
import { ROTULO_STATUS } from '@/modulos/agenda/consulta';
import { obterSerie, ROTULO_SERIE } from '@/modulos/agenda/serie-consulta';
import { dadosDaRenovacao, TEXTO_ERRO_RENOVACAO } from '@/modulos/agenda/serie-renovacao';
import { carregarSala } from '@/modulos/configuracao/espaco';
import PagamentoPix from '../../PagamentoPix';
import { parametrosDoPedido } from '../../reservar/serie/pedido-serie';
import { cancelarMinhaSerieAction } from '../actions';

export const metadata = { title: 'Série' };

const AVISOS: Record<string, string> = {
  pedido_enviado: 'Pedido enviado. Todas as datas estão retidas para você. Os responsáveis vão responder em breve, e você será avisado por e-mail.',
  cancelada: 'Série cancelada e horários liberados.',
  cancelada_credito: 'Série cancelada e horários liberados. O crédito das datas pagas já está na sua carteira.',
};
const ERROS: Record<string, string> = {
  estado: 'O estado desta série mudou. Confira abaixo.',
};

export default async function DetalheDaSerie({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aviso?: string; erro?: string }>;
}) {
  const { sessao } = await exigirProfissional();
  const { id } = await params;
  const { aviso, erro } = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const dados = await obterSerie(id);
  // Série de outra pessoa é como se não existisse.
  if (!dados || dados.serie.profissionalId !== sessao.user.id) notFound();

  const { serie, reservas, cobrancas, descricao } = dados;
  const rotulo = ROTULO_SERIE[serie.status] ?? { nome: serie.status, cor: 'bg-zinc-100 text-zinc-700' };
  const sala = await carregarSala();
  const chave = process.env.PIX_MANUAL_CHAVE?.trim();
  const favorecido = process.env.PIX_MANUAL_NOME?.trim();
  const reservaPorId = new Map(reservas.map((r) => [r.id, r]));
  const abertas = cobrancas.filter((c) => c.cobranca.status === 'pendente');
  const pagas = cobrancas.filter((c) => c.cobranca.status === 'paga' && c.cobranca.valorCobradoCentavos > 0);
  const podeCancelar = serie.status === 'solicitada' || serie.status === 'aprovada';
  const renovacao = serie.status === 'aprovada' || serie.status === 'encerrada' ? await dadosDaRenovacao(serie.id, sessao.user.id) : null;
  const regras = sala?.regras;

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <Link href="/series" className="text-sm underline">
        ← Minhas séries
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{descricao}</h1>
        <span className={`rounded-full px-2 py-0.5 text-xs ${rotulo.cor}`}>{rotulo.nome}</span>
      </div>
      <p className="text-sm text-zinc-700">{serie.formaPagamento === 'pacote_mes' ? 'Pagamento por pacote do mês' : 'Pagamento por data'}</p>

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

      {serie.status === 'solicitada' && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Aguardando a resposta dos responsáveis. As datas estão retidas para você; sem resposta no prazo, são liberadas.
        </p>
      )}

      {abertas.map(({ cobranca, reservaIds }) => (
        <section key={cobranca.id} className="space-y-2 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-950">
          <h2 className="font-semibold">{cobranca.finalidade === 'pacote_mes' ? 'Pague o pacote do mês por Pix' : 'Pague esta data por Pix'}</h2>
          <ul className="list-disc pl-5">
            {reservaIds.map((rid) => {
              const r = reservaPorId.get(rid);
              return r ? <li key={rid}>{descreverPeriodo(r.inicio, r.fim)}</li> : null;
            })}
          </ul>
          {cobranca.creditoUsadoCentavos > 0 && <p className="text-xs">Já descontados {formatarReais(cobranca.creditoUsadoCentavos)} do seu crédito.</p>}
          {cobranca.pixCopiaCola ? (
            <PagamentoPix valorCentavos={cobranca.valorCobradoCentavos} copiaCola={cobranca.pixCopiaCola} qrImagem={cobranca.pixQrImagem} faturaUrl={cobranca.asaasLinkFatura} />
          ) : (
            <>
              <p>
                Valor a pagar: <strong>{formatarReais(cobranca.valorCobradoCentavos)}</strong>
              </p>
              {chave ? (
                <p>
                  Chave Pix: <strong>{chave}</strong>
                  {favorecido ? ` · Favorecido: ${favorecido}` : ''}
                </p>
              ) : (
                <p>Os responsáveis vão enviar os dados do pagamento por e-mail.</p>
              )}
              <p>Depois do pagamento, os responsáveis confirmam o recebimento e as datas ficam confirmadas.</p>
            </>
          )}
          {cobranca.venceEm && (
            <p>
              Prazo: até <strong>{descreverMomento(cobranca.venceEm)}</strong>. Sem pagamento até lá, as datas acima são liberadas.
            </p>
          )}
        </section>
      ))}

      <section aria-label="Datas" className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
        <h2 className="font-semibold">As datas</h2>
        <ul className="space-y-1">
          {reservas.map((r) => {
            const s = ROTULO_STATUS[r.status] ?? { nome: r.status, cor: 'bg-zinc-100 text-zinc-700' };
            return (
              <li key={r.id}>
                <Link href={`/minhas-reservas/${r.id}`} className="flex flex-wrap items-center gap-2 hover:underline">
                  <span>{descreverPeriodo(r.inicio, r.fim)}</span>
                  <span className="text-zinc-600">{formatarReais(r.valorCentavos)}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${s.cor}`}>{s.nome}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {pagas.length > 0 && (
        <section aria-label="Recibos" className="space-y-1 rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
          <h2 className="font-semibold">Pagamentos recebidos</h2>
          <ul className="space-y-1">
            {pagas.map(({ cobranca }) => (
              <li key={cobranca.id}>
                {formatarReais(cobranca.valorCobradoCentavos)}
                {cobranca.pagoEm ? ` em ${descreverMomento(cobranca.pagoEm)}` : ''} ·{' '}
                <a href={`/api/recibos/${cobranca.id}`} target="_blank" rel="noopener noreferrer" className="underline">
                  Baixar recibo (PDF)
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {renovacao && (
        <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
          <h2 className="font-semibold">Renovar a série</h2>
          {renovacao.ok ? (
            <>
              <p>Continue com o mesmo horário: o pedido já vem preenchido, para o período seguinte, e passa por aprovação como o anterior.</p>
              <Link
                href={`/reservar/serie?${parametrosDoPedido(renovacao.pedido, { renovacaoDe: serie.id }).toString()}`}
                className="inline-block rounded-lg bg-zinc-900 px-4 py-2.5 font-medium text-white"
              >
                Renovar série
              </Link>
            </>
          ) : (
            <p className="text-zinc-700">{TEXTO_ERRO_RENOVACAO[renovacao.erro]}</p>
          )}
        </section>
      )}

      {podeCancelar && (
        <section className="space-y-3 rounded-2xl border border-red-200 bg-white p-4 text-sm">
          <h2 className="font-semibold">Cancelar a série</h2>
          <p className="text-zinc-700">
            Cancela todas as datas que ainda não começaram e libera os horários. Pagamentos ainda abertos são cancelados. Datas já pagas voltam como crédito pela política de cancelamento
            {regras
              ? `: 100% com ${regras.cancelamentoIntegralHoras} horas ou mais de antecedência, ${regras.cancelamentoParcialPct}% com ${regras.cancelamentoParcialHoras} horas ou mais, e nada abaixo disso`
              : ''}
            . Para cancelar só uma data, abra-a na lista acima.
          </p>
          <form action={cancelarMinhaSerieAction}>
            <input type="hidden" name="id" value={serie.id} />
            <button type="submit" className="rounded-lg border border-red-700 bg-white px-4 py-2.5 font-medium text-red-800 hover:bg-red-700 hover:text-white">
              Cancelar a série inteira
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
