'use server';

import { redirect } from 'next/navigation';
import { contextoRequisicao, exigirAnfitriao } from '@/lib/sessao';
import { carregarSala } from '@/modulos/configuracao/espaco';
import { salvarPrecos } from '@/modulos/configuracao/tabela';

const texto = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

export async function salvarPrecosAction(formData: FormData) {
  const sessao = await exigirAnfitriao();
  const sala = await carregarSala();
  if (!sala) redirect('/configuracoes/precos');

  const turnos: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (k.startsWith('turno:')) turnos[k.slice(6)] = texto(v);

  const { ip } = await contextoRequisicao();
  const r = await salvarPrecos(
    sala.espaco.id,
    sessao.user.id,
    { hora: texto(formData.get('hora')), dia: texto(formData.get('dia')), turnos, desde: texto(formData.get('desde')) },
    ip,
  );
  if (!r.ok) redirect(`/configuracoes/precos?erro=${r.erro}`);
  redirect(`/configuracoes/precos?aviso=${r.mudancas === 0 ? 'sem_mudanca' : r.agendado ? 'agendado' : 'salvo'}`);
}
