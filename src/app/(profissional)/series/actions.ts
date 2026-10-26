'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { contextoRequisicao, exigirProfissional } from '@/lib/sessao';
import { cancelarSerie } from '@/modulos/agenda/serie-cancelamento';
import { EstadoReservaError, ReservaNaoEncontradaError } from '@/modulos/agenda/solicitacao';

export async function cancelarMinhaSerieAction(formData: FormData) {
  const { sessao } = await exigirProfissional();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) redirect('/series');
  const { ip } = await contextoRequisicao();
  let destino: string;
  try {
    const r = await cancelarSerie(id.data, { id: sessao.user.id, papel: 'profissional' }, { ip });
    destino = r.creditoCentavos > 0 ? 'aviso=cancelada_credito' : 'aviso=cancelada';
  } catch (e) {
    if (e instanceof ReservaNaoEncontradaError) redirect('/series');
    else if (e instanceof EstadoReservaError) destino = 'erro=estado';
    else throw e;
  }
  redirect(`/series/${id.data}?${destino}`);
}
