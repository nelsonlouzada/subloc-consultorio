'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { contextoRequisicao, exigirAnfitriao } from '@/lib/sessao';
import {
  aprovarReserva,
  CadastroPendenteError,
  EstadoReservaError,
  PrazoVencidoError,
  recusarReserva,
  ReservaNaoEncontradaError,
} from '@/modulos/agenda/solicitacao';

const esquema = z.object({
  id: z.string().uuid(),
  motivo: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((m) => m || null),
  aprovarCadastro: z.preprocess((v) => v === 'on', z.boolean()),
});

function ler(formData: FormData) {
  const lido = esquema.safeParse({
    id: formData.get('id'),
    motivo: formData.get('motivo') ?? undefined,
    aprovarCadastro: formData.get('aprovarCadastro'),
  });
  if (!lido.success) redirect('/solicitacoes');
  return lido.data;
}

/** Traduz o erro de negócio num código curto para a tela (nunca texto vindo da URL). */
function codigoDoErro(e: unknown): string {
  if (e instanceof PrazoVencidoError) return 'prazo';
  if (e instanceof CadastroPendenteError) return 'cadastro';
  if (e instanceof EstadoReservaError) return 'estado';
  if (e instanceof ReservaNaoEncontradaError) return 'estado';
  throw e;
}

export async function aprovarSolicitacaoAction(formData: FormData) {
  const sessao = await exigirAnfitriao();
  const { id, aprovarCadastro } = ler(formData);
  const { ip } = await contextoRequisicao();
  try {
    await aprovarReserva(id, sessao.user.id, { aprovarCadastro, ip });
  } catch (e) {
    redirect(`/solicitacoes?erro=${codigoDoErro(e)}`);
  }
  redirect('/solicitacoes?aviso=aprovada');
}

export async function recusarSolicitacaoAction(formData: FormData) {
  const sessao = await exigirAnfitriao();
  const { id, motivo } = ler(formData);
  const { ip } = await contextoRequisicao();
  try {
    await recusarReserva(id, sessao.user.id, motivo, { ip });
  } catch (e) {
    redirect(`/solicitacoes?erro=${codigoDoErro(e)}`);
  }
  redirect('/solicitacoes?aviso=recusada');
}
