'use server';

import { redirect } from 'next/navigation';
import { formatarDataISO } from '@/lib/fuso';
import { contextoRequisicao, exigirProfissional } from '@/lib/sessao';
import { hojeLocal } from '@/modulos/agenda/calendario';
import { criarReserva } from '@/modulos/agenda/reserva';
import { carregarSala, horaInteira } from '@/modulos/configuracao/espaco';
import { dataValida, type ParametrosPedido, pedidoDosParametros } from './pedido';

const texto = (f: FormData, campo: string) => {
  const v = f.get(campo);
  return typeof v === 'string' ? v : undefined;
};

export async function enviarPedidoAction(formData: FormData) {
  const { sessao } = await exigirProfissional();

  const params: ParametrosPedido = {
    data: texto(formData, 'data'),
    unidade: texto(formData, 'unidade'),
    de: texto(formData, 'de'),
    ate: texto(formData, 'ate'),
    turno: texto(formData, 'turno'),
  };
  const dia = dataValida(params.data);
  const dataQuery = formatarDataISO(dia ?? hojeLocal());

  // O aceite do termo é obrigatório e vale por pedido: sem ele, volta ao resumo.
  if (texto(formData, 'aceiteTermo') !== 'on') {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
    q.set('erro', 'termo');
    redirect(`/reservar/resumo?${q.toString()}`);
  }

  const sala = await carregarSala();
  if (!sala) redirect(`/reservar?data=${dataQuery}&erro=sem_regras`);

  const pedido = await pedidoDosParametros(
    params,
    sala.espaco.id,
    sessao.user.id,
    horaInteira(sala.regras.abre),
    horaInteira(sala.regras.fecha),
  );
  if (!pedido) redirect(`/reservar?data=${dataQuery}&erro=unidade_invalida`);

  // O preço NUNCA vem do formulário: é recalculado aqui, no servidor.
  const r = await criarReserva(pedido, await contextoRequisicao());
  if (!r.ok) redirect(`/reservar?data=${dataQuery}&erro=${r.erro}`);
  redirect(`/reservar?data=${dataQuery}&aviso=pedido_enviado`);
}
