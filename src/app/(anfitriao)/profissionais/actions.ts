'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { contextoRequisicao, exigirAnfitriao } from '@/lib/sessao';
import { reaisParaCentavos } from '@/lib/dinheiro';
import { carregarSala } from '@/modulos/configuracao/espaco';
import { CreditoManualInvalidoError, concederCreditoManual, ProfissionalSemCadastroError } from '@/modulos/carteira/manual';
import {
  aprovarProfissional,
  bloquearProfissional,
  desbloquearProfissional,
  ProfissionalNaoEncontradoError,
  recusarProfissional,
  TransicaoInvalidaError,
} from '@/modulos/identidade/aprovacao';

const esquema = z.object({
  id: z.string().min(1).max(100),
  motivo: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((m) => m || null),
});

type Acao = 'aprovar' | 'recusar' | 'bloquear' | 'desbloquear';

async function executar(acao: Acao, formData: FormData): Promise<never> {
  const sessao = await exigirAnfitriao();
  const lido = esquema.safeParse({ id: formData.get('id'), motivo: formData.get('motivo') ?? undefined });
  if (!lido.success) redirect('/profissionais');
  const { id, motivo } = lido.data;
  const { ip } = await contextoRequisicao();

  let resultado: string;
  try {
    if (acao === 'aprovar') await aprovarProfissional(id, sessao.user.id, ip);
    else if (acao === 'recusar') await recusarProfissional(id, sessao.user.id, motivo, ip);
    else if (acao === 'bloquear') await bloquearProfissional(id, sessao.user.id, motivo, ip);
    else await desbloquearProfissional(id, sessao.user.id, ip);
    resultado = `aviso=${acao}`;
  } catch (e) {
    if (e instanceof TransicaoInvalidaError) resultado = 'erro=estado';
    else if (e instanceof ProfissionalNaoEncontradoError) redirect('/profissionais');
    else throw e;
  }
  redirect(`/profissionais/${encodeURIComponent(id)}?${resultado}`);
}

export const aprovarAction = async (f: FormData) => executar('aprovar', f);
export const recusarAction = async (f: FormData) => executar('recusar', f);
export const bloquearAction = async (f: FormData) => executar('bloquear', f);
export const desbloquearAction = async (f: FormData) => executar('desbloquear', f);

export async function concederCreditoAction(formData: FormData) {
  const sessao = await exigirAnfitriao();
  const id = z.string().min(1).max(100).safeParse(formData.get('id'));
  if (!id.success) redirect('/profissionais');
  const sala = await carregarSala();
  if (!sala) redirect(`/profissionais/${encodeURIComponent(id.data)}`);
  const { ip } = await contextoRequisicao();
  const valorCentavos = reaisParaCentavos(String(formData.get('valor') ?? ''));
  let resultado: string;
  try {
    if (valorCentavos === null) throw new CreditoManualInvalidoError('valor');
    await concederCreditoManual(
      { anfitriaoId: sessao.user.id, profissionalId: id.data, espacoId: sala.espaco.id, valorCentavos, motivo: String(formData.get('motivo') ?? '') },
      { ip },
    );
    resultado = 'aviso=credito';
  } catch (e) {
    if (e instanceof CreditoManualInvalidoError) resultado = `erro=credito_${e.motivo}`;
    else if (e instanceof ProfissionalSemCadastroError) redirect('/profissionais');
    else throw e;
  }
  redirect(`/profissionais/${encodeURIComponent(id.data)}?${resultado}`);
}
