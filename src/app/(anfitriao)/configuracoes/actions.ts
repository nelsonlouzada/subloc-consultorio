'use server';

import { redirect } from 'next/navigation';
import { contextoRequisicao, exigirAnfitriao } from '@/lib/sessao';
import { carregarSala } from '@/modulos/configuracao/espaco';
import { lerRegras, salvarRegras } from '@/modulos/configuracao/regras';

export async function salvarRegrasAction(formData: FormData) {
  const sessao = await exigirAnfitriao();
  const sala = await carregarSala();
  if (!sala) redirect('/configuracoes');

  const entrada = { ...Object.fromEntries(formData), diasFuncionamento: formData.getAll('diasFuncionamento') };
  const lido = lerRegras(entrada);
  if (!lido.ok) redirect(`/configuracoes?erro=${lido.erro}`);

  const { ip } = await contextoRequisicao();
  const { mudou } = await salvarRegras(sala.espaco.id, sessao.user.id, lido.regras, ip);
  redirect(`/configuracoes?aviso=${mudou.length ? 'salvo' : 'sem_mudanca'}`);
}
