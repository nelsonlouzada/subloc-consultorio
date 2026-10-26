import { TZDate } from '@date-fns/tz';

// Regras de agenda (funcionamento, turnos, véspera) são em hora local da sala.
// A conversão acontece só aqui: o resto do código recebe e devolve instantes (Date em UTC).
export const FUSO_SALA = 'America/Sao_Paulo';

/** Monta o instante correspondente a uma data e hora locais da sala. */
export function instanteLocal(ano: number, mes: number, dia: number, hora = 0, minuto = 0): Date {
  return new Date(new TZDate(ano, mes - 1, dia, hora, minuto, 0, FUSO_SALA).getTime());
}

export type DataLocal = { ano: number; mes: number; dia: number };

/** Anos aceitos em datas vindas de formulário ou da URL: fora disso é erro de digitação (ou ataque), não data de agenda. */
export const ANO_MINIMO = 2000;
export const ANO_MAXIMO = 2100;

/**
 * 'YYYY-MM-DD' vindo de um formulário ou da URL, sem passar por Date (evita deslize de fuso).
 * Só aceita datas que existem no calendário: '2026-02-31' e '9999-99-99' são recusadas (antes eram
 * "corrigidas" em silêncio, e a segunda chegava ao banco como o ano 10007 e derrubava a página).
 */
export function parseDataISO(texto: string): DataLocal {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
  if (!m) throw new Error(`Data inválida: ${texto}`);
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  if (ano < ANO_MINIMO || ano > ANO_MAXIMO || mes < 1 || mes > 12 || dia < 1 || dia > diasNoMes) {
    throw new Error(`Data inválida: ${texto}`);
  }
  return { ano, mes, dia };
}

/** A mesma conferência de `parseDataISO`, como pergunta de sim ou não (para validar formulários). */
export function dataISOValida(texto: string): boolean {
  try {
    parseDataISO(texto);
    return true;
  } catch {
    return false;
  }
}

/** Soma dias a uma data local, já normalizada (31/01 + 1 = 01/02). */
export function somarDias(d: DataLocal, dias: number): DataLocal {
  const p = partesLocais(instanteLocal(d.ano, d.mes, d.dia + dias, 12));
  return { ano: p.ano, mes: p.mes, dia: p.dia };
}

/** Dia da semana de uma data local: 1 = segunda ... 7 = domingo. */
export function diaSemanaDe(d: DataLocal): number {
  return partesLocais(instanteLocal(d.ano, d.mes, d.dia, 12)).diaSemana;
}

export function formatarDataISO(d: DataLocal): string {
  return `${d.ano}-${String(d.mes).padStart(2, '0')}-${String(d.dia).padStart(2, '0')}`;
}

/** Data e hora locais da sala para um instante. */
export function partesLocais(instante: Date) {
  const z = new TZDate(instante.getTime(), FUSO_SALA);
  return {
    ano: z.getFullYear(),
    mes: z.getMonth() + 1,
    dia: z.getDate(),
    hora: z.getHours(),
    minuto: z.getMinutes(),
    diaSemana: z.getDay() === 0 ? 7 : z.getDay(), // 1 = segunda ... 7 = domingo
  };
}
