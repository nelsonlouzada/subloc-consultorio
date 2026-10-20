import {
  type DataLocal,
  diaSemanaDe,
  formatarDataISO,
  instanteLocal,
  partesLocais,
  somarDias,
} from '@/lib/fuso';

/** Segunda-feira da semana que contém a data. */
export function segundaDaSemana(d: DataLocal): DataLocal {
  return somarDias(d, -(diaSemanaDe(d) - 1));
}

/** Os sete dias (segunda a domingo) da semana que contém a data. */
export function diasDaSemana(d: DataLocal): DataLocal[] {
  const segunda = segundaDaSemana(d);
  return Array.from({ length: 7 }, (_, i) => somarDias(segunda, i));
}

/** Grade do mês: semanas completas de segunda a domingo, com dias dos meses vizinhos nas pontas. */
export function semanasDoMes(ano: number, mes: number): DataLocal[][] {
  const primeiro = { ano, mes, dia: 1 };
  const ultimo = somarDias({ ano: mes === 12 ? ano + 1 : ano, mes: mes === 12 ? 1 : mes + 1, dia: 1 }, -1);
  const semanas: DataLocal[][] = [];
  for (let seg = segundaDaSemana(primeiro); formatarDataISO(seg) <= formatarDataISO(ultimo); seg = somarDias(seg, 7)) {
    semanas.push(Array.from({ length: 7 }, (_, i) => somarDias(seg, i)));
  }
  return semanas;
}

/** Início do dia local e início do dia seguinte, como instantes. */
export function limitesDoDia(d: DataLocal): [Date, Date] {
  return [instanteLocal(d.ano, d.mes, d.dia, 0), instanteLocal(d.ano, d.mes, d.dia + 1, 0)];
}

/** Data local de hoje na sala. */
export function hojeLocal(agora = new Date()): DataLocal {
  const p = partesLocais(agora);
  return { ano: p.ano, mes: p.mes, dia: p.dia };
}

const DIAS_CURTOS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
export const nomeDiaCurto = (d: DataLocal) => DIAS_CURTOS[diaSemanaDe(d) - 1];

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const nomeMes = (mes: number) => MESES[mes - 1];

/** '28/10 às 21:33' em hora local da sala: para prazos. */
export function descreverMomento(d: Date): string {
  const p = partesLocais(d);
  return `${String(p.dia).padStart(2, '0')}/${String(p.mes).padStart(2, '0')} às ${horaTexto(d)}`;
}

/** 'seg 02/11, 09:00 às 12:00' em hora local da sala (reserva dentro de um mesmo dia). */
export function descreverPeriodo(inicio: Date, fim: Date): string {
  const d = hojeLocal(inicio);
  const dia = `${nomeDiaCurto(d)} ${String(d.dia).padStart(2, '0')}/${String(d.mes).padStart(2, '0')}`;
  return `${dia}, ${horaTexto(inicio)} às ${horaTexto(fim)}`;
}

/** '07:30' a partir de um instante, em hora local da sala. */
export function horaTexto(instante: Date): string {
  const p = partesLocais(instante);
  return `${String(p.hora).padStart(2, '0')}:${String(p.minuto).padStart(2, '0')}`;
}
