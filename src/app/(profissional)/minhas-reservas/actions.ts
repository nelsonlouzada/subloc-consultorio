'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { contextoRequisicao, exigirProfissional } from '@/lib/sessao';
import { cancelarReservaPeloProfissional, ReservaJaIniciadaError } from '@/modulos/agenda/cancelamento';
import { EstadoReservaError, ReservaNaoEncontradaError } from '@/modulos/agenda/solicitacao';

export async function cancelarMinhaReservaAction(formData: FormData) {
  const { sessao } = await exigirProfissional();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) redirect('/minhas-reservas');
  const { ip } = await contextoRequisicao();
  let destino: string;
  try {
    const r = await cancelarReservaPeloProfissional(id.data, sessao.user.id, { ip });
    destino = r.creditoCentavos > 0 ? 'aviso=cancelada_credito' : 'aviso=cancelada';
  } catch (e) {
    if (e instanceof ReservaJaIniciadaError) destino = 'erro=iniciada';
    else if (e instanceof EstadoReservaError) destino = 'erro=estado';
    else if (e instanceof ReservaNaoEncontradaError) redirect('/minhas-reservas');
    else throw e;
  }
  redirect(`/minhas-reservas/${id.data}?${destino}`);
}
