import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatarDataISO } from '@/lib/fuso';
import { formatarReais } from '@/lib/dinheiro';
import { exigirProfissional } from '@/lib/sessao';
import { descreverPeriodo, hojeLocal } from '@/modulos/agenda/calendario';
import { saldoDisponivel } from '@/modulos/carteira/carteira';
import { avaliarPedido } from '@/modulos/agenda/reserva';
import { carregarSala, horaInteira } from '@/modulos/configuracao/espaco';
import { enviarPedidoAction } from '../actions';
import { dataValida, type ParametrosPedido, pedidoDosParametros } from '../pedido';

export const metadata = { title: 'Resumo do pedido' };

const UNIDADE = { hora: 'Por hora', turno: 'Turno', dia: 'Dia inteiro' } as const;

export default async function Resumo({ searchParams }: { searchParams: Promise<ParametrosPedido & { erro?: string }> }) {
  const { sessao } = await exigirProfissional();
  const busca = await searchParams;
  const dia = dataValida(busca.data);
  const voltar = `/reservar?data=${formatarDataISO(dia ?? hojeLocal())}`;

  const sala = await carregarSala();
  if (!sala) redirect(`${voltar}&erro=sem_regras`);
  const pedido = await pedidoDosParametros(busca, sala.espaco.id, sessao.user.id, horaInteira(sala.regras.abre), horaInteira(sala.regras.fecha));
  if (!pedido) redirect(`${voltar}&erro=unidade_invalida`);

  // Mesma conferência da criação: se o horário já não cabe, volta à escolha com o motivo.
  const r = await avaliarPedido(pedido);
  if (!r.ok) redirect(`${voltar}&erro=${r.erro}`);
  const { preco, termo, regras } = r.avaliado;
  const d = preco.detalhe;
  const saldo = await saldoDisponivel(sessao.user.id);
  const abatimento = Math.min(saldo, preco.valorCentavos);

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <Link href={voltar} className="text-sm underline">
        ← Escolher outro horário
      </Link>
      <h1 className="text-2xl font-semibold">Resumo do pedido</h1>

      {busca.erro === 'termo' && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          Para enviar o pedido, é preciso aceitar o termo de reserva.
        </p>
      )}

      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4">
        <p className="text-lg font-medium">{descreverPeriodo(pedido.inicio, pedido.fim)}</p>
        <p className="text-sm text-zinc-600">
          {UNIDADE[pedido.unidade]} · {preco.horas} {preco.horas === 1 ? 'hora' : 'horas'}
        </p>
        <p className="text-2xl font-semibold">{formatarReais(preco.valorCentavos)}</p>
        <details className="text-sm text-zinc-700">
          <summary className="cursor-pointer">Como o valor foi calculado</summary>
          <ul className="mt-2 space-y-1">
            {d.porTurno.map((t) => (
              <li key={t.turnoId}>
                {t.nome}: {t.horas} {t.horas === 1 ? 'hora' : 'horas'} → {formatarReais(t.centavos)}
              </li>
            ))}
            {d.foraDeTurno.horas > 0 && (
              <li>
                Hora entre os turnos: {d.foraDeTurno.horas} → {formatarReais(d.foraDeTurno.centavos)}
              </li>
            )}
            <li>Soma: {formatarReais(d.somaCentavos)}</li>
            <li>
              Dia inteiro: {formatarReais(d.diaCentavos)}
              {d.usouDia ? ' (menor valor, é o que vale)' : ''}
            </li>
          </ul>
          <p className="mt-2 text-xs text-zinc-600">Sempre cobramos o menor valor possível para as horas pedidas.</p>
        </details>
      </section>

      <section className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
        <h2 className="font-semibold">O que acontece depois</h2>
        <ol className="list-decimal space-y-1 pl-5 text-zinc-700">
          <li>O horário fica retido para você assim que você enviar.</li>
          <li>Os responsáveis pela sala aprovam ou recusam em até {regras.prazoAprovacaoHoras} horas.</li>
          <li>Aprovado, você recebe os dados do pagamento por Pix e tem {regras.prazoPagamentoHoras} horas para pagar. Pago, a reserva é confirmada.</li>
          <li>Sem aprovação ou sem pagamento no prazo, o horário é liberado.</li>
        </ol>
      </section>

      <form action={enviarPedidoAction} className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-4">
        <input type="hidden" name="data" value={busca.data ?? ''} />
        <input type="hidden" name="unidade" value={busca.unidade ?? ''} />
        <input type="hidden" name="de" value={busca.de ?? ''} />
        <input type="hidden" name="ate" value={busca.ate ?? ''} />
        <input type="hidden" name="turno" value={busca.turno ?? ''} />

        {saldo > 0 && (
          <label className="flex items-start gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-950">
            <input type="hidden" name="usarCreditoVisto" value="1" />
            <input type="checkbox" name="usarCredito" defaultChecked className="mt-1" />
            <span>
              Usar meu crédito (saldo de {formatarReais(saldo)}). O que vence primeiro é usado primeiro. Se o pedido for aprovado, abatemos até{' '}
              <strong>{formatarReais(abatimento)}</strong>
              {abatimento >= preco.valorCentavos ? ' e a reserva é confirmada na hora, sem Pix.' : `, e você paga o restante (${formatarReais(preco.valorCentavos - abatimento)}) por Pix.`} O valor final é fechado na aprovação.
            </span>
          </label>
        )}

        <div>
          <p id="termo-titulo" className="mb-1 text-sm font-medium">
            Termo de reserva (versão {termo.versao})
          </p>
          <div
            role="region"
            aria-labelledby="termo-titulo"
            tabIndex={0}
            className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-zinc-300 bg-zinc-50 p-3 text-sm"
          >
            {termo.texto}
          </div>
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" name="aceiteTermo" required aria-label="Li e aceito o termo de reserva" className="mt-1" />
            <span>Li e aceito o termo de reserva.</span>
          </label>
        </div>

        <button type="submit" className="w-full rounded-lg bg-zinc-900 px-4 py-3 font-medium text-white">
          Enviar pedido
        </button>
      </form>
    </div>
  );
}
