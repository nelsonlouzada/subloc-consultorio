'use server';

import { redirect } from 'next/navigation';
import { contextoRequisicao, exigirAnfitriao } from '@/lib/sessao';
import { carregarSala } from '@/modulos/configuracao/espaco';
import { lerSala, salvarSala } from '@/modulos/configuracao/sala';

export async function salvarSalaAction(formData: FormData) {
  const sessao = await exigirAnfitriao();
  const sala = await carregarSala();
  if (!sala) redirect('/configuracoes/sala');

  const lido = lerSala(Object.fromEntries(formData));
  if (!lido.ok) redirect(`/configuracoes/sala?erro=${lido.erro}`);

  const { ip } = await contextoRequisicao();
  const { mudou } = await salvarSala(sala.espaco.id, sessao.user.id, lido.dados, ip);
  redirect(`/configuracoes/sala?aviso=${mudou.length ? 'salvo' : 'sem_mudanca'}`);
}
