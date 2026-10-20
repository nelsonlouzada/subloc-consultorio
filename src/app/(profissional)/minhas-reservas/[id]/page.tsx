import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { formatarReais } from '@/lib/dinheiro';
import { exigirProfissional } from '@/lib/sessao';
import { descreverMomento, descreverPeriodo } from '@/modulos/agenda/calendario';
import { obterReserva, ROTULO_STATUS } from '@/modulos/agenda/consulta';

export const metadata = { title: 'Reserva' };

const UNIDADE = { hora: 'por hora', turno: 'turno', dia: 'dia inteiro' } as const;

export default async function DetalheDaReserva({ params }: { params: Promise<{ id: string }> }) {
  const { sessao } = await exigirProfissional();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const dados = await obterReserva(id);
  // Reserva de outra pessoa é como se não existisse.
  if (!dados || dados.reserva.profissionalId !== sessao.user.id) notFound();

  const { reserva: r, cobranca } = dados;
  const s = ROTULO_STATUS[r.status] ?? { nome: r.status, cor: 'bg-zinc-100 text-zinc-700' };
  const chave = process.env.PIX_MANUAL_CHAVE?.trim();
  const favorecido = process.env.PIX_MANUAL_NOME?.trim();

  // Linha do tempo só com o que realmente aconteceu.
  const eventos: { quando: Date; texto: string }[] = [{ quando: r.criadoEm, texto: 'Pedido enviado' }];
  if (r.aprovadaEm && r.status !== 'recusada') eventos.push({ quando: r.aprovadaEm, texto: 'Pedido aprovado' });
  if (r.aprovadaEm && r.status === 'recusada') eventos.push({ quando: r.aprovadaEm, texto: 'Pedido recusado' });
  if (cobranca?.pagoEm) eventos.push({ quando: cobranca.pagoEm, texto: 'Pagamento confirmado' });
  if (r.canceladaEm) eventos.push({ quando: r.canceladaEm, texto: 'Reserva cancelada' });
  if (r.codigoAcessoEnviadoEm) eventos.push({ quando: r.codigoAcessoEnviadoEm, texto: 'Código de acesso enviado' });
  eventos.sort((a, b) => a.quando.getTime() - b.quando.getTime());

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <Link href="/minhas-reservas" className="text-sm underline">
        ← Minhas reservas
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{descreverPeriodo(r.inicio, r.fim)}</h1>
        <span className={`rounded-full px-2 py-0.5 text-xs ${s.cor}`}>{s.nome}</span>
      </div>
      <p className="text-sm text-zinc-700">
        {UNIDADE[r.unidade]} · {formatarReais(r.valorCentavos)}
      </p>

      {r.status === 'solicitada' && (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          O horário está retido para você. Os responsáveis pela sala vão responder{r.prazoAprovacaoAte ? ` até ${descreverMomento(r.prazoAprovacaoAte)}` : ''}. Sem resposta até lá, o horário é liberado.
        </p>
      )}

      {r.status === 'aguardando_pagamento' && (
        <section className="space-y-2 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-950">
          <h2 className="font-semibold">Pague por Pix para confirmar</h2>
          <p>
            Valor a pagar: <strong>{formatarReais(cobranca?.valorCobradoCentavos ?? r.valorCentavos)}</strong>
            {cobranca && cobranca.creditoUsadoCentavos > 0 && ` (já descontados ${formatarReais(cobranca.creditoUsadoCentavos)} do seu crédito)`}
          </p>
          {chave ? (
            <p>
              Chave Pix: <strong>{chave}</strong>
              {favorecido ? ` · Favorecido: ${favorecido}` : ''}
            </p>
          ) : (
            <p>Os responsáveis vão enviar os dados do pagamento por e-mail.</p>
          )}
          {r.prazoPagamentoAte && (
            <p>
              Prazo: até <strong>{descreverMomento(r.prazoPagamentoAte)}</strong>. Sem pagamento até lá, o horário é liberado.
            </p>
          )}
          <p>Depois do pagamento, os responsáveis confirmam o recebimento e a reserva fica confirmada.</p>
        </section>
      )}

      {r.status === 'confirmada' && (
        <section className="space-y-2 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-950">
          <h2 className="font-semibold">Código de acesso</h2>
          {r.codigoAcesso ? (
            <p>
              <strong className="text-2xl tracking-widest">{r.codigoAcesso}</strong>
              <br />
              O código é pessoal, vale só para este horário e não deve ser repassado.
            </p>
          ) : (
            <p>Será enviado por e-mail pelos responsáveis antes do horário.</p>
          )}
        </section>
      )}

      {r.status === 'recusada' && r.motivoRecusa && (
        <p className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm">Motivo informado: {r.motivoRecusa}</p>
      )}
      {r.status === 'cancelada' && (
        <p className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
          Esta reserva foi cancelada pelos responsáveis e o horário foi liberado.
          {cobranca?.status === 'paga' ? ` O valor pago${r.creditoGeradoCentavos ? ` (${formatarReais(r.creditoGeradoCentavos)})` : ''} virou crédito na sua carteira.` : ''}
        </p>
      )}
      {r.status === 'expirada' && (
        <p className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">
          Este pedido expirou e o horário foi liberado. Se você já pagou, fale com os responsáveis pela sala.
        </p>
      )}

      <section aria-label="Linha do tempo" className="rounded-2xl border border-zinc-200 bg-white p-4">
        <h2 className="mb-2 font-semibold">Linha do tempo</h2>
        <ol className="space-y-1 text-sm">
          {eventos.map((e, i) => (
            <li key={i}>
              {descreverMomento(e.quando)} · {e.texto}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
