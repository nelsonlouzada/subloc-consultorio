'use server';

import { redirect } from 'next/navigation';
import { contextoRequisicao, exigirAnfitriao } from '@/lib/sessao';
import { publicarVersao, type TipoDocumento } from '@/modulos/configuracao/documentos';

export async function publicarDocumentoAction(formData: FormData) {
  const sessao = await exigirAnfitriao();
  const tipo = formData.get('tipo');
  if (tipo !== 'contrato' && tipo !== 'termo_reserva') redirect('/configuracoes/documentos');
  const texto = formData.get('texto');

  const { ip } = await contextoRequisicao();
  const r = await publicarVersao(tipo as TipoDocumento, sessao.user.id, typeof texto === 'string' ? texto : '', ip);
  if (!r.ok) redirect(`/configuracoes/documentos?doc=${tipo}&erro=${r.erro}`);
  redirect(`/configuracoes/documentos?doc=${tipo}&aviso=publicado`);
}
