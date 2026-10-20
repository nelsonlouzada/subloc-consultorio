import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { formatarReais } from '@/lib/dinheiro';
import { exigirAnfitriao } from '@/lib/sessao';
import { listarAuditoriaDe } from '@/modulos/auditoria/auditoria';
import { descreverMomento, descreverPeriodo } from '@/modulos/agenda/calendario';
import { obterReserva, ROTULO_STATUS } from '@/modulos/agenda/consulta';
import { cancelarReservaAction, desfazerFaltaAction, enviarCodigoAction, marcarPagoAction, registrarFaltaAction } from '../actions';

export const metadata = { title: 'Reserva' };

const AVISOS: Record<string, string> = {
  pago: 'Pagamento registrado. A reserva está confirmada e o profissional foi avisado por e-mail.',
  pago_credito: 'Pagamento registrado. O pedido já tinha expirado e o horário não estava mais livre: o valor virou crédito na carteira do profissional, que foi avisado.',
  falta: 'Falta registrada. O profissional foi avisado por e-mail.',
  falta_desfeita: 'Falta desfeita.',
  pago_reativada: 'Pagamento registrado. O horário ainda estava livre: a reserva voltou e está confirmada.',
  codigo: 'Código enviado ao profissional por e-mail.',
  cancelada: 'Reserva cancelada. O horário foi liberado e o profissional foi avisado por e-mail.',
  cancelada_paga:
    'Reserva cancelada e o horário liberado. O valor pago virou crédito integral na carteira do profissional.',
};
const ERROS: Record<string, string> = {
  estado: 'O estado desta reserva mudou. Confira abaixo e tente de novo.',
  codigo: 'Código inválido. Use de 3 a 20 caracteres: números, letras, * # ou -.',
  credito_devolvido: 'O crédito que abatia este pedido já voltou para a carteira e o saldo atual não cobre. Resolva com a pessoa por fora antes de marcar.',
  nao_iniciada: 'A reserva ainda não começou: só dá para registrar falta depois do início.',
  iniciada: 'A reserva já começou e não pode mais ser cancelada.',
};
const NOME_ACAO: Record<string, string> = {
  reserva_solicitada: 'Pedido enviado',
  reserva_aprovada: 'Pedido aprovado',
  reserva_recusada: 'Pedido recusado',
  reserva_cancelada: 'Reserva cancelada',
  reserva_cancelada_profissional: 'Reserva cancelada pelo profissional',
  reserva_expirada_aprovacao: 'Expirou sem aprovação',
  reserva_expirada_pagamento: 'Expirou sem pagamento',
  pagamento_marcado: 'Pagamento marcado como recebido',
  pagamento_marcado_apos_expirar: 'Pagamento marcado depois de expirar (horário reativado)',
  codigo_acesso_enviado: 'Código de acesso enviado',
  pagamento_atrasado_virou_credito: 'Pagamento atrasado recebido: virou crédito',
  falta_registrada: 'Falta registrada',
  falta_desfeita: 'Falta desfeita',
};
const UNIDADE = { hora: 'por hora', turno: 'turno', dia: 'dia inteiro' } as const;
const quando = (d: Date) => descreverMomento(d);
const botao = 'rounded-lg px-4 py-2.5 font-medium';

export default async function ReservaDoAnfitriao({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aviso?: string; erro?: string }>;
}) {
  await exigirAnfitriao();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { aviso, erro } = await searchParams;
  const dados = await obterReserva(id);
  if (!dados) notFound();
  const { reserva: r, cobranca, profissionalNome, profissionalEmail, aprovadaPorNome } = dados;
  const historico = await listarAuditoriaDe('reserva', id);
  const s = ROTULO_STATUS[r.status] ?? { nome: r.status, cor: 'bg-zinc-100 text-zinc-700' };

  const podeMarcarPago = r.status === 'aguardando_pagamento' || (r.status === 'expirada' && cobranca?.status === 'expirada');
  const comecou = r.inicio <= new Date();
  const podeRegistrarFalta = (r.status === 'confirmada' || r.status === 'realizada') && comecou;
  const podeCancelar = (r.status === 'aguardando_pagamento' || r.status === 'confirmada') && r.inicio > new Date();

  return (
    <div className="space-y-5">
      <Link href="/solicitacoes" className="text-sm underline">
        ← Solicitações
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{descreverPeriodo(r.inicio, r.fim)}</h1>
        <span className={`rounded-full px-2 py-0.5 text-xs ${s.cor}`}>{s.nome}</span>
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
          <Link href={`/profissionais/${encodeURIComponent(r.profissionalId)}`} className="underline">
            {profissionalNome}
          </Link>{' '}
          · {profissionalEmail}
        </p>
        <p>
          <span className="text-zinc-500">Reserva:</span> {UNIDADE[r.unidade]} · {formatarReais(r.valorCentavos)}
        </p>
        <p>
          <span className="text-zinc-500">Pedido em:</span> {quando(r.criadoEm)}
          {aprovadaPorNome && r.aprovadaEm && (
            <>
              {' · '}
              <span className="text-zinc-500">decidido por</span> {aprovadaPorNome} em {quando(r.aprovadaEm)}
            </>
          )}
        </p>
        {r.motivoRecusa && (
          <p>
            <span className="text-zinc-500">Motivo da recusa:</span> {r.motivoRecusa}
          </p>
        )}
      </section>

      {cobranca && (
        <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
          <h2 className="font-semibold">Pagamento</h2>
          <p>
            {formatarReais(cobranca.valorCobradoCentavos)} · cobrança {cobranca.status}
            {cobranca.meio === 'pix_manual' && ' · Pix conferido manualmente'}
            {cobranca.meio === 'credito' && ' · pago com crédito'}
            {cobranca.creditoUsadoCentavos > 0 && cobranca.meio !== 'credito' && ` · abatido ${formatarReais(cobranca.creditoUsadoCentavos)} de crédito`}
            {cobranca.pagoEm && ` · pago em ${quando(cobranca.pagoEm)}`}
          </p>
          {r.status === 'aguardando_pagamento' && cobranca.venceEm && (
            <p>
              Pagar até <strong>{quando(cobranca.venceEm)}</strong>. Sem pagamento até lá, o horário é liberado.
            </p>
          )}
          {r.status === 'expirada' && cobranca.status === 'expirada' && (
            <p className="text-amber-900">
              O prazo de pagamento venceu. Se o Pix chegou mesmo assim, marque abaixo: se o horário ainda estiver livre, a reserva volta; se não estiver, o valor vira crédito na carteira do profissional.
            </p>
          )}
          {podeMarcarPago && (
            <form action={marcarPagoAction}>
              <input type="hidden" name="id" value={r.id} />
              <button type="submit" className={`${botao} bg-zinc-900 text-white`}>
                Marcar pagamento como recebido
              </button>
              <p className="mt-1 text-xs text-zinc-600">Confira o Pix no seu banco antes de marcar. A reserva é confirmada na hora.</p>
            </form>
          )}
        </section>
      )}

      {r.status === 'confirmada' && (
        <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
          <h2 className="font-semibold">Código de acesso</h2>
          <p className="text-zinc-700">
            {r.codigoAcessoEnviadoEm
              ? `Enviado em ${quando(r.codigoAcessoEnviadoEm)}. Pode enviar outro, se precisar.`
              : 'Ainda não enviado. Gere o código no aplicativo da fechadura e digite aqui.'}
          </p>
          <form action={enviarCodigoAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={r.id} />
            <div>
              <label htmlFor="codigo" className="block text-xs text-zinc-600">
                Código
              </label>
              <input id="codigo" name="codigo" required autoComplete="off" maxLength={20} className="rounded-lg border border-zinc-300 px-3 py-2" />
            </div>
            <button type="submit" className={`${botao} bg-zinc-900 text-white`}>
              {r.codigoAcessoEnviadoEm ? 'Reenviar código' : 'Enviar código'}
            </button>
          </form>
          <p className="text-xs text-zinc-600">O código fica guardado só até a reserva terminar e depois é apagado.</p>
        </section>
      )}

      {podeCancelar && (
        <section className="space-y-3 rounded-2xl border border-red-200 bg-white p-4 text-sm">
          <h2 className="font-semibold">Cancelar reserva</h2>
          <p className="text-zinc-700">
            O horário é liberado na hora, o código de acesso deixa de valer e o profissional é avisado por e-mail.
            {r.status === 'confirmada' && ' O pagamento já foi recebido: o valor vira crédito integral na carteira do profissional.'}
          </p>
          <form action={cancelarReservaAction} className="space-y-2">
            <input type="hidden" name="id" value={r.id} />
            <div>
              <label htmlFor="motivo" className="block text-xs text-zinc-600">
                Motivo (opcional, vai no e-mail)
              </label>
              <input id="motivo" name="motivo" maxLength={500} autoComplete="off" className="w-full rounded-lg border border-zinc-300 px-3 py-2" />
            </div>
            <button type="submit" className={`${botao} border border-red-700 bg-white text-red-800 hover:bg-red-700 hover:text-white`}>
              Cancelar esta reserva
            </button>
          </form>
        </section>
      )}

      {(podeRegistrarFalta || r.status === 'falta') && (
        <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white p-4 text-sm">
          <h2 className="font-semibold">Comparecimento</h2>
          {r.status === 'falta' ? (
            <form action={desfazerFaltaAction} className="space-y-2">
              <input type="hidden" name="id" value={r.id} />
              <p className="text-zinc-700">Falta registrada: a pessoa não usou a sala. Se foi engano, desfaça.</p>
              <button type="submit" className={`${botao} border border-zinc-400 bg-white`}>
                Desfazer a falta
              </button>
            </form>
          ) : (
            <form action={registrarFaltaAction} className="space-y-2">
              <input type="hidden" name="id" value={r.id} />
              <p className="text-zinc-700">Se a pessoa não apareceu, registre a falta. Não gera crédito, e a pessoa é avisada por e-mail.</p>
              <button type="submit" className={`${botao} border border-red-700 bg-white text-red-800 hover:bg-red-700 hover:text-white`}>
                Registrar falta
              </button>
            </form>
          )}
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
                {quando(h.quando)} · {NOME_ACAO[h.acao] ?? h.acao}
                {h.quem ? ` por ${h.quem}` : ' (automático)'}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
