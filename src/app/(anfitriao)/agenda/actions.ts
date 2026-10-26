'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { exigirAnfitriao } from '@/lib/sessao';
import { dataISOValida, formatarDataISO, instanteLocal, parseDataISO, somarDias } from '@/lib/fuso';
import { hojeLocal } from '@/modulos/agenda/calendario';
import { criarBloqueio, criarBloqueiosRecorrentes, removerBloqueio, removerGrupoBloqueios } from '@/modulos/agenda/bloqueio';
import { ConflitoAgendaError } from '@/modulos/agenda/ocupacao';
import { carregarSala } from '@/modulos/configuracao/espaco';

const dataISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(dataISOValida, 'Data inexistente');

const esquemaBloqueio = z
  .object({
    tipo: z.enum(['uso_proprio', 'indisponivel']),
    data: dataISO,
    horaInicio: z.coerce.number().int().min(0).max(23),
    horaFim: z.coerce.number().int().min(1).max(24),
    motivo: z.string().trim().max(200).optional(),
    repetir: z.boolean(),
    dias: z.array(z.coerce.number().int().min(1).max(7)),
    ate: dataISO.optional(),
  })
  .refine((v) => v.horaFim > v.horaInicio, { path: ['horaFim'] });

function voltar(data: string, extra: Record<string, string>): never {
  const q = new URLSearchParams({ data, ...extra });
  redirect(`/agenda?${q.toString()}`);
}

export async function criarBloqueioAction(formData: FormData) {
  const sessao = await exigirAnfitriao();
  const dataBruta = String(formData.get('data') ?? '');

  const lido = esquemaBloqueio.safeParse({
    tipo: formData.get('tipo'),
    data: dataBruta,
    horaInicio: formData.get('horaInicio'),
    horaFim: formData.get('horaFim'),
    motivo: String(formData.get('motivo') ?? '') || undefined,
    repetir: formData.get('repetir') === 'on',
    dias: formData.getAll('dias'),
    ate: String(formData.get('ate') ?? '') || undefined,
  });
  const fallback = dataISO.safeParse(dataBruta).success ? dataBruta : formatarDataISO(hojeLocal());
  if (!lido.success) voltar(fallback, { erro: 'dados' });
  const v = lido.data;

  const sala = await carregarSala();
  if (!sala) voltar(v.data, { erro: 'sem-sala' });

  const comum = {
    espacoId: sala.espaco.id,
    tipo: v.tipo,
    motivo: v.motivo ?? null,
    criadoPor: sessao.user.id,
    travaMinutos: sala.regras.travaMinutos,
  };
  const dia = parseDataISO(v.data);

  if (!v.repetir) {
    try {
      await criarBloqueio({
        ...comum,
        inicio: instanteLocal(dia.ano, dia.mes, dia.dia, v.horaInicio),
        fim: instanteLocal(dia.ano, dia.mes, dia.dia, v.horaFim),
      });
    } catch (e) {
      if (e instanceof ConflitoAgendaError) voltar(v.data, { erro: e.motivo });
      throw e;
    }
    voltar(v.data, { aviso: 'criado', n: '1' });
  }

  if (v.dias.length === 0 || !v.ate) voltar(v.data, { erro: 'repeticao' });
  const ate = parseDataISO(v.ate);
  if (formatarDataISO(ate) < v.data || formatarDataISO(ate) > formatarDataISO(somarDias(dia, 365))) {
    voltar(v.data, { erro: 'repeticao' });
  }

  let resultado;
  try {
    resultado = await criarBloqueiosRecorrentes({
      ...comum,
      diasSemana: v.dias,
      inicioHora: v.horaInicio,
      fimHora: v.horaFim,
      dataInicio: dia,
      dataFim: ate,
    });
  } catch {
    voltar(v.data, { erro: 'repeticao' });
  }
  voltar(v.data, {
    aviso: 'criado',
    n: String(resultado.criados.length),
    ...(resultado.conflitos.length ? { conflitos: resultado.conflitos.map((c) => c.data).join(',') } : {}),
  });
}

const esquemaId = z.object({ id: z.string().uuid(), data: dataISO });

export async function removerBloqueioAction(formData: FormData) {
  await exigirAnfitriao();
  const lido = esquemaId.safeParse({ id: formData.get('id'), data: formData.get('data') });
  if (!lido.success) redirect('/agenda');
  await removerBloqueio(lido.data.id);
  voltar(lido.data.data, { aviso: 'removido', n: '1' });
}

export async function removerGrupoAction(formData: FormData) {
  await exigirAnfitriao();
  const lido = esquemaId.safeParse({ id: formData.get('grupoId'), data: formData.get('data') });
  if (!lido.success) redirect('/agenda');
  const apagados = await removerGrupoBloqueios(lido.data.id);
  voltar(lido.data.data, { aviso: 'removido', n: String(apagados) });
}
