'use server';

import { redirect } from 'next/navigation';
import { contextoRequisicao, exigirAnfitriao } from '@/lib/sessao';
import { carregarSala } from '@/modulos/configuracao/espaco';
import { salvarTurnos, type NovoTurno, type TurnoEditavel } from '@/modulos/configuracao/tabela';

const texto = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');
const hora = (v: FormDataEntryValue | null) => (texto(v).trim() === '' ? NaN : Number(texto(v)));

export async function salvarTurnosAction(formData: FormData) {
  const sessao = await exigirAnfitriao();
  const sala = await carregarSala();
  if (!sala) redirect('/configuracoes/turnos');

  const turnos: TurnoEditavel[] = formData.getAll('id').map((raw) => {
    const id = texto(raw);
    return {
      id,
      nome: texto(formData.get(`nome:${id}`)),
      inicio: hora(formData.get(`inicio:${id}`)),
      fim: hora(formData.get(`fim:${id}`)),
      ativo: formData.get(`ativo:${id}`) === 'on',
    };
  });
  const novo: NovoTurno | null = texto(formData.get('novoNome')).trim()
    ? {
        nome: texto(formData.get('novoNome')),
        inicio: hora(formData.get('novoInicio')),
        fim: hora(formData.get('novoFim')),
        valor: texto(formData.get('novoValor')),
      }
    : null;

  const { ip } = await contextoRequisicao();
  const r = await salvarTurnos(sala.espaco.id, sessao.user.id, turnos, novo, ip);
  if (!r.ok) redirect(`/configuracoes/turnos?erro=${r.erro}`);
  redirect(`/configuracoes/turnos?aviso=${r.mudancas ? 'salvo' : 'sem_mudanca'}`);
}
