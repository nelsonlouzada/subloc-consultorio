import { TZDate } from '@date-fns/tz';

// Regras de agenda (funcionamento, turnos, véspera) são em hora local da sala.
// A conversão acontece só aqui: o resto do código recebe e devolve instantes (Date em UTC).
export const FUSO_SALA = 'America/Sao_Paulo';

/** Monta o instante correspondente a uma data e hora locais da sala. */
export function instanteLocal(ano: number, mes: number, dia: number, hora = 0, minuto = 0): Date {
  return new Date(new TZDate(ano, mes - 1, dia, hora, minuto, 0, FUSO_SALA).getTime());
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
