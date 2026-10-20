'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { exigirProfissional } from '@/lib/sessao';
import { comprarPacote } from '@/modulos/cobranca/pacotes';

export async function comprarPacoteAction(formData: FormData) {
  const { sessao } = await exigirProfissional();
  const pacoteId = z.string().uuid().safeParse(formData.get('pacoteId'));
  if (!pacoteId.success) redirect('/carteira?erro=pacote_invalido');
  const r = await comprarPacote(sessao.user.id, pacoteId.data);
  if (!r.ok) redirect(`/carteira?erro=${r.erro}`);
  redirect(`/carteira/pagar/${r.cobrancaId}`);
}
