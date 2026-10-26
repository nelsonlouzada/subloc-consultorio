'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { contextoRequisicao, exigirAnfitriao } from '@/lib/sessao';
import { CodigoInvalidoError, enviarCodigoAcesso } from '@/modulos/agenda/acesso';
import { cancelarReserva, OcorrenciaEmPacoteError, ReservaJaIniciadaError } from '@/modulos/agenda/cancelamento';
import { desfazerFalta, registrarFalta, ReservaNaoIniciadaError } from '@/modulos/agenda/falta';
import { marcarPagoDaReserva } from '@/modulos/agenda/marcar-pago';
import { CreditoInsuficienteError } from '@/modulos/agenda/pagamento';
import { EstadoReservaError, ReservaNaoEncontradaError } from '@/modulos/agenda/solicitacao';

const id = z.string().uuid();

function ler(formData: FormData) {
  const lido = id.safeParse(formData.get('id'));
  if (!lido.success) redirect('/agenda');
  return lido.data;
}

const voltar = (reservaId: string, extra: string): never => redirect(`/reservas/${reservaId}?${extra}`);

export async function marcarPagoAction(formData: FormData) {
  const sessao = await exigirAnfitriao();
  const reservaId = ler(formData);
  const { ip } = await contextoRequisicao();
  let aviso: string;
  try {
    const r = await marcarPagoDaReserva(reservaId, sessao.user.id, { ip });
    aviso = r.creditoCentavos > 0 ? 'aviso=pago_credito' : r.reativada ? 'aviso=pago_reativada' : 'aviso=pago';
  } catch (e) {
    if (e instanceof CreditoInsuficienteError) aviso = 'erro=credito_devolvido';
    else if (e instanceof EstadoReservaError || e instanceof ReservaNaoEncontradaError) aviso = 'erro=estado';
    else throw e;
  }
  voltar(reservaId, aviso);
}

export async function cancelarReservaAction(formData: FormData) {
  const sessao = await exigirAnfitriao();
  const reservaId = ler(formData);
  const { ip } = await contextoRequisicao();
  const motivo = String(formData.get('motivo') ?? '');
  let resultado: string;
  try {
    const r = await cancelarReserva(reservaId, sessao.user.id, motivo, { ip });
    resultado = r.creditoCentavos > 0 ? 'aviso=cancelada_paga' : 'aviso=cancelada';
  } catch (e) {
    if (e instanceof ReservaJaIniciadaError) resultado = 'erro=iniciada';
    else if (e instanceof OcorrenciaEmPacoteError) resultado = 'erro=pacote';
    else if (e instanceof EstadoReservaError || e instanceof ReservaNaoEncontradaError) resultado = 'erro=estado';
    else throw e;
  }
  voltar(reservaId, resultado);
}

export async function enviarCodigoAction(formData: FormData) {
  const sessao = await exigirAnfitriao();
  const reservaId = ler(formData);
  const { ip } = await contextoRequisicao();
  let resultado: string;
  try {
    await enviarCodigoAcesso(reservaId, sessao.user.id, String(formData.get('codigo') ?? ''), { ip });
    resultado = 'aviso=codigo';
  } catch (e) {
    if (e instanceof CodigoInvalidoError) resultado = 'erro=codigo';
    else if (e instanceof EstadoReservaError || e instanceof ReservaNaoEncontradaError) resultado = 'erro=estado';
    else throw e;
  }
  voltar(reservaId, resultado);
}

async function mudarFalta(formData: FormData, acao: typeof registrarFalta, aviso: string) {
  const sessao = await exigirAnfitriao();
  const reservaId = ler(formData);
  const { ip } = await contextoRequisicao();
  let resultado: string;
  try {
    await acao(reservaId, sessao.user.id, { ip });
    resultado = `aviso=${aviso}`;
  } catch (e) {
    if (e instanceof ReservaNaoIniciadaError) resultado = 'erro=nao_iniciada';
    else if (e instanceof EstadoReservaError || e instanceof ReservaNaoEncontradaError) resultado = 'erro=estado';
    else throw e;
  }
  voltar(reservaId, resultado);
}

export const registrarFaltaAction = async (f: FormData) => mudarFalta(f, registrarFalta, 'falta');
export const desfazerFaltaAction = async (f: FormData) => mudarFalta(f, desfazerFalta, 'falta_desfeita');
