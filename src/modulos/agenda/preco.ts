import { partesLocais } from '@/lib/fuso';

export type TurnoPreco = {
  id: string;
  nome: string;
  /** Hora local cheia em que o turno começa (7 = 07h) e termina (12 = 12h). */
  inicio: number;
  fim: number;
  centavos: number;
};

export type TabelaPrecos = {
  horaCentavos: number;
  diaCentavos: number;
  turnos: TurnoPreco[];
};

export type CalculoPreco = {
  /** O que o Profissional paga: sempre o menor preço possível para essas horas. */
  valorCentavos: number;
  horas: number;
  detalhe: {
    porTurno: { turnoId: string; nome: string; horas: number; centavos: number }[];
    foraDeTurno: { horas: number; centavos: number };
    /** Soma das horas pelo melhor preço de cada turno, antes de comparar com o dia inteiro. */
    somaCentavos: number;
    diaCentavos: number;
    /** O preço do dia inteiro foi o menor. */
    usouDia: boolean;
  };
};

export class PedidoInvalidoError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'PedidoInvalidoError';
  }
}

const HORA_MS = 3_600_000;

/**
 * Menor preço possível para um intervalo contínuo num dia (modelo-de-dados.md, seção 5):
 * 1. para cada turno, o menor entre (horas dentro dele x preço da hora) e (preço do turno);
 * 2. horas fora de turno (a 12h-13h) custam o preço da hora;
 * 3. o total é comparado com o preço do dia inteiro, e vale o menor.
 * Assim o Profissional nunca paga mais por pedir mais horas.
 */
export function calcularPreco(inicio: Date, fim: Date, tabela: TabelaPrecos): CalculoPreco {
  const duracao = fim.getTime() - inicio.getTime();
  if (duracao <= 0) throw new PedidoInvalidoError('O fim precisa ser depois do início.');
  if (duracao % HORA_MS !== 0) throw new PedidoInvalidoError('A reserva é em horas cheias.');

  const pIni = partesLocais(inicio);
  if (pIni.minuto !== 0) throw new PedidoInvalidoError('A reserva é em horas cheias.');
  const horas = duracao / HORA_MS;
  const horaFinal = pIni.hora + horas;
  if (horaFinal > 24) throw new PedidoInvalidoError('A reserva precisa terminar no mesmo dia (até 24h).');

  const contagem = new Map<string, number>();
  let foraDeTurno = 0;
  for (let h = pIni.hora; h < horaFinal; h++) {
    const turno = tabela.turnos.find((t) => h >= t.inicio && h < t.fim);
    if (turno) contagem.set(turno.id, (contagem.get(turno.id) ?? 0) + 1);
    else foraDeTurno++;
  }

  const porTurno = tabela.turnos
    .filter((t) => contagem.has(t.id))
    .map((t) => {
      const h = contagem.get(t.id)!;
      return { turnoId: t.id, nome: t.nome, horas: h, centavos: Math.min(h * tabela.horaCentavos, t.centavos) };
    });
  const foraCentavos = foraDeTurno * tabela.horaCentavos;
  const soma = porTurno.reduce((s, t) => s + t.centavos, 0) + foraCentavos;
  const usouDia = tabela.diaCentavos < soma;

  return {
    valorCentavos: Math.min(soma, tabela.diaCentavos),
    horas,
    detalhe: {
      porTurno,
      foraDeTurno: { horas: foraDeTurno, centavos: foraCentavos },
      somaCentavos: soma,
      diaCentavos: tabela.diaCentavos,
      usouDia,
    },
  };
}
