'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { contextoRequisicao, exigirAnfitriao } from '@/lib/sessao';
import { aprovarSerie, recusarSerie } from '@/modulos/agenda/serie-aprovacao';
import { cancelarSerie } from '@/modulos/agenda/serie-cancelamento';
import { marcarPagoCobrancaDeSerie } from '@/modulos/agenda/serie-pagamento';
import { CadastroPendenteError, EstadoReservaError, PrazoVencidoError, ReservaNaoEncontradaError } from '@/modulos/agenda/solicitacao';

const uuid = z.string().uuid();

function lerSerie(formData: FormData) {
  const id = uuid.safeParse(formData.get('id'));
  if (!id.success) redirect('/solicitacoes');
  return id.data;
}

/** Traduz o erro de negócio num código curto para a tela (nunca texto vindo da URL). */
function codigoDoErro(e: unknown): string {
  if (e instanceof PrazoVencidoError) return 'prazo';
  if (e instanceof CadastroPendenteError) return 'cadastro';
  if (e instanceof EstadoReservaError || e instanceof ReservaNaoEncontradaError) return 'estado';
  throw e;
}

const voltar = (id: string, extra: string): never => redirect(`/series-da-sala/${id}?${extra}`);

export async function aprovarSerieAction(formData: FormData) {
  const sessao = await exigirAnfitriao();
  const id = lerSerie(formData);
  const { ip } = await contextoRequisicao();
  try {
    await aprovarSerie(id, sessao.user.id, { aprovarCadastro: formData.get('aprovarCadastro') === 'on', ip });
  } catch (e) {
    voltar(id, `erro=${codigoDoErro(e)}`);
  }
  voltar(id, 'aviso=aprovada');
}

export async function recusarSerieAction(formData: FormData) {
  const sessao = await exigirAnfitriao();
  const id = lerSerie(formData);
  const { ip } = await contextoRequisicao();
  const motivo = z.string().trim().max(300).safeParse(formData.get('motivo') ?? '');
  try {
    await recusarSerie(id, sessao.user.id, (motivo.success && motivo.data) || null, { ip });
  } catch (e) {
    voltar(id, `erro=${codigoDoErro(e)}`);
  }
  voltar(id, 'aviso=recusada');
}

export async function marcarPagoSerieAction(formData: FormData) {
  const sessao = await exigirAnfitriao();
  const id = lerSerie(formData);
  const cobrancaId = uuid.safeParse(formData.get('cobrancaId'));
  if (!cobrancaId.success) redirect(`/series-da-sala/${id}`);
  const { ip } = await contextoRequisicao();
  let resultado: string;
  try {
    const r = await marcarPagoCobrancaDeSerie(cobrancaId.data, sessao.user.id, { ip });
    resultado = !r ? 'erro=estado' : r.viraramCredito > 0 ? 'aviso=pago_credito' : 'aviso=pago';
  } catch (e) {
    resultado = `erro=${codigoDoErro(e)}`;
  }
  voltar(id, resultado);
}

export async function cancelarSerieAnfitriaoAction(formData: FormData) {
  const sessao = await exigirAnfitriao();
  const id = lerSerie(formData);
  const { ip } = await contextoRequisicao();
  let resultado: string;
  try {
    const r = await cancelarSerie(id, { id: sessao.user.id, papel: 'anfitriao' }, { ip });
    resultado = r.creditoCentavos > 0 ? 'aviso=cancelada_credito' : 'aviso=cancelada';
  } catch (e) {
    resultado = `erro=${codigoDoErro(e)}`;
  }
  voltar(id, resultado);
}
