'use server';

import { redirect } from 'next/navigation';
import { contextoRequisicao, exigirProfissional } from '@/lib/sessao';
import { criarSerie } from '@/modulos/agenda/serie';
import { dadosDaRenovacao } from '@/modulos/agenda/serie-renovacao';
import { carregarSala } from '@/modulos/configuracao/espaco';
import { type ParametrosSerie, parametrosDoPedido, pedidoDeSerieDosParametros } from './pedido-serie';

const texto = (f: FormData, campo: string) => {
  const v = f.get(campo);
  return typeof v === 'string' ? v : undefined;
};

export async function enviarSerieAction(formData: FormData) {
  const { sessao } = await exigirProfissional();

  const params: ParametrosSerie = {
    dias: formData.getAll('dias').filter((v): v is string => typeof v === 'string'),
    freq: texto(formData, 'freq'),
    unidade: texto(formData, 'unidade'),
    turno: texto(formData, 'turno'),
    de: texto(formData, 'de'),
    ate: texto(formData, 'ate'),
    inicio: texto(formData, 'inicio'),
    fim: texto(formData, 'fim'),
    pag: texto(formData, 'pag'),
    renovacaoDe: texto(formData, 'renovacaoDe'),
  };

  const sala = await carregarSala();
  if (!sala) redirect('/reservar/serie?erro=sem_regras');
  const pedido = pedidoDeSerieDosParametros(params, sala.espaco.id, sessao.user.id);
  if (!pedido) redirect('/reservar/serie?erro=unidade_invalida');
  const extra: Record<string, string> = params.renovacaoDe ? { renovacaoDe: params.renovacaoDe } : {};

  // O aceite do termo é obrigatório e vale por série: sem ele, volta ao resumo.
  if (texto(formData, 'aceiteTermo') !== 'on') {
    redirect(`/reservar/serie/resumo?${parametrosDoPedido(pedido, { ...extra, erro: 'termo' }).toString()}`);
  }

  // Só liga a série à anterior se ela for mesmo desta pessoa e ainda puder ser renovada.
  let renovacaoDeId: string | null = null;
  if (params.renovacaoDe) {
    const dados = await dadosDaRenovacao(params.renovacaoDe, sessao.user.id);
    if (dados.ok) renovacaoDeId = dados.renovacaoDeId;
  }

  // O preço NUNCA vem do formulário: é recalculado aqui, no servidor.
  const r = await criarSerie(pedido, await contextoRequisicao(), new Date(), {
    // Campo ausente (a pessoa não tinha crédito na tela) vale "usar", para o crédito que chegar depois abater também.
    usarCredito: texto(formData, 'usarCreditoVisto') ? texto(formData, 'usarCredito') === 'on' : true,
    renovacaoDeId,
  });
  if (!r.ok) redirect(`/reservar/serie?${parametrosDoPedido(pedido, { ...extra, erro: r.erro }).toString()}`);
  redirect(`/series/${r.serieId}?aviso=pedido_enviado`);
}
