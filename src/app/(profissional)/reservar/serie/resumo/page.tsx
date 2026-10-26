import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatarReais } from '@/lib/dinheiro';
import { partesLocais } from '@/lib/fuso';
import { exigirProfissional } from '@/lib/sessao';
import { descreverMomento, descreverPeriodo } from '@/modulos/agenda/calendario';
import { TEXTO_MOTIVO } from '@/modulos/agenda/disponibilidade';
import { avaliarSerie, descreverSerie } from '@/modulos/agenda/serie';
import { DIAS_ANTECEDENCIA_COBRANCA } from '@/modulos/agenda/serie-cobranca';
import { saldoDisponivel } from '@/modulos/carteira/carteira';
import { carregarSala } from '@/modulos/configuracao/espaco';
import { enviarSerieAction } from '../actions';
import { type ParametrosSerie, parametrosDoPedido, pedidoDeSerieDosParametros } from '../pedido-serie';

export const metadata = { title: 'Resumo da série' };

export default async function ResumoSerie({ searchParams }: { searchParams: Promise<ParametrosSerie> }) {
  const { sessao } = await exigirProfissional();
  const busca = await searchParams;
  const sala = await carregarSala();
  if (!sala) redirect('/reservar/serie?erro=sem_regras');
  const pedido = pedidoDeSerieDosParametros(busca, sala.espaco.id, sessao.user.id);
  if (!pedido) redirect('/reservar/serie?erro=unidade_invalida');

  const extra: Record<string, string> = busca.renovacaoDe ? { renovacaoDe: busca.renovacaoDe } : {};
  const r = await avaliarSerie(pedido);
  // Mesma conferência da criação: se a série não fecha, volta ao formulário (preenchido) com o motivo.
  if (!r.ok) redirect(`/reservar/serie?${parametrosDoPedido(pedido, { ...extra, erro: r.erro }).toString()}`);
  const { ocorrencias, validas, totalCentavos, termo, regras, horario, descontoPct, prazoAprovacaoAte } = r.avaliada;
  const ignoradas = ocorrencias.length - validas.length;
  const saldo = await saldoDisponivel(sessao.user.id);
  const abatimento = Math.min(saldo, totalCentavos);
  const meses = new Set(validas.map((o) => `${partesLocais(o.inicio).ano}-${partesLocais(o.inicio).mes}`)).size;
  const pacote = pedido.formaPagamento === 'pacote_mes';
  const voltar = `/reservar/serie?${parametrosDoPedido(pedido, extra).toString()}`;
  const descricao = descreverSerie({
    diasSemana: pedido.diasSemana,
    frequencia: pedido.frequencia,
    horaInicio: horario.de,
    horaFim: horario.ate,
    dataInicio: `${pedido.dataInicio.ano}-${String(pedido.dataInicio.mes).padStart(2, '0')}-${String(pedido.dataInicio.dia).padStart(2, '0')}`,
    dataFim: `${pedido.dataFim.ano}-${String(pedido.dataFim.mes).padStart(2, '0')}-${String(pedido.dataFim.dia).padStart(2, '0')}`,
  });

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <Link href={voltar} className="inline-block py-1 text-sm underline">
        ← Ajustar a série
      </Link>
      <h1 className="text-2xl font-semibold">Resumo da série</h1>

      {busca.erro === 'termo' && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          Para enviar o pedido, é preciso aceitar o termo de reserva.
        </p>
      )}

      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4">
        <p className="text-lg font-medium">{descricao}</p>
        <p className="text-2xl font-semibold">{formatarReais(totalCentavos)}</p>
        <p className="text-sm text-zinc-600">
          {validas.length} {validas.length === 1 ? 'data' : 'datas'}
          {pacote && descontoPct > 0 ? `, já com ${descontoPct}% de desconto do pacote do mês` : ''}
        </p>
      </section>

      <section aria-label="Datas" className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
        <h2 className="font-semibold">As datas</h2>
        <ul className="space-y-1">
          {ocorrencias.map((o) => (
            <li key={o.inicio.toISOString()} className={o.motivo ? 'text-zinc-500' : ''}>
              {descreverPeriodo(o.inicio, o.fim)} ·{' '}
              {o.motivo ? (
                <span>
                  <strong>fica de fora</strong>: {TEXTO_MOTIVO[o.motivo]}
                </span>
              ) : (
                formatarReais(o.valorCentavos)
              )}
            </li>
          ))}
        </ul>
        {ignoradas > 0 && (
          <p className="text-xs text-zinc-600">
            As datas que ficam de fora não entram na série. Se preferir, volte e ajuste os dias ou o horário.
          </p>
        )}
      </section>

      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
        <h2 className="font-semibold">O que acontece depois</h2>
        <ol className="list-decimal space-y-1 pl-5 text-zinc-700">
          <li>Todas as datas ficam retidas para você assim que enviar.</li>
          <li>Os responsáveis aprovam ou recusam a série inteira em até {regras.prazoAprovacaoHoras} horas.</li>
          <li>
            {pacote
              ? `Aprovada, você paga por Pix o primeiro mês na hora (${meses} ${meses === 1 ? 'pagamento' : 'pagamentos'} no total, um por mês); os seguintes chegam ${DIAS_ANTECEDENCIA_COBRANCA} dias antes de cada mês.`
              : `Aprovada, você recebe um link de pagamento para cada data, ${DIAS_ANTECEDENCIA_COBRANCA} dias antes dela.`}
          </li>
          <li>Pagamento não feito no prazo libera aquelas datas. Você pode cancelar a série quando quiser: datas pagas voltam como crédito pela política de cancelamento.</li>
        </ol>
        <p className="text-xs text-zinc-600">Prazo de resposta dos responsáveis: até {descreverMomento(prazoAprovacaoAte)}.</p>
      </section>

      <form action={enviarSerieAction} className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4">
        {[...parametrosDoPedido(pedido, extra).entries()].map(([k, v], i) => (
          <input key={`${k}-${i}`} type="hidden" name={k} value={v} />
        ))}

        {saldo > 0 && (
          <label className="flex items-start gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-950">
            <input type="hidden" name="usarCreditoVisto" value="1" />
            <input type="checkbox" name="usarCredito" defaultChecked className="mt-1" />
            <span>
              Usar meu crédito (saldo de {formatarReais(saldo)}). Ele abate cada cobrança quando ela é gerada, começando pelo que vence primeiro, até {formatarReais(abatimento)} no total da série.
            </span>
          </label>
        )}

        <div>
          <p id="termo-titulo" className="mb-1 text-sm font-medium">
            Termo de reserva (versão {termo.versao})
          </p>
          <div role="region" aria-labelledby="termo-titulo" tabIndex={0} className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-zinc-300 bg-zinc-50 p-3 text-sm">
            {termo.texto}
          </div>
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" name="aceiteTermo" required aria-label="Li e aceito o termo de reserva" className="mt-1" />
            <span>Li e aceito o termo de reserva, para todas as datas desta série.</span>
          </label>
        </div>

        <button type="submit" className="w-full rounded-lg bg-zinc-900 px-4 py-3 font-medium text-white">
          Enviar pedido da série
        </button>
      </form>
    </div>
  );
}
