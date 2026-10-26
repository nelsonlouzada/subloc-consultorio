'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { contextoRequisicao, exigirProfissional } from '@/lib/sessao';
import { cancelarReservaPeloProfissional, OcorrenciaEmPacoteError, ReservaJaIniciadaError } from '@/modulos/agenda/cancelamento';
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
    else if (e instanceof OcorrenciaEmPacoteError) destino = 'erro=pacote';
    else if (e instanceof EstadoReservaError) destino = 'erro=estado';
    else if (e instanceof ReservaNaoEncontradaError) redirect('/minhas-reservas');
    else throw e;
  }
  // Remarcar = cancelar pela política e já escolher outro horário; o crédito gerado é usado por padrão.
  if (formData.get('remarcar') && destino.startsWith('aviso=')) redirect('/reservar?aviso=remarcar');
  redirect(`/minhas-reservas/${id.data}?${destino}`);
}
