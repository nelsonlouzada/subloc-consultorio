import { db, schema } from '@/db';

// Aceita o banco ou uma transação (inclusive um savepoint).
export type Executor = Pick<typeof db, 'insert' | 'select' | 'delete' | 'update'>;

export type MotivoConflito = 'sobreposicao' | 'trava';

export class ConflitoAgendaError extends Error {
  constructor(public readonly motivo: MotivoConflito) {
    super(
      motivo === 'sobreposicao'
        ? 'Este horário já está ocupado.'
        : 'Este horário fica dentro da hora de intervalo entre dois ocupantes diferentes.',
    );
    this.name = 'ConflitoAgendaError';
  }
}

/** Texto de intervalo do Postgres: início incluído, fim excluído. */
export function intervalo(inicio: Date, fim: Date): string {
  return `[${inicio.toISOString()},${fim.toISOString()})`;
}

/** Alarga o período em metade da trava de cada lado (trava de 60 min: 9h-10h vira 8h30-10h30). */
export function comTrava(inicio: Date, fim: Date, travaMinutos: number): [Date, Date] {
  const meia = (travaMinutos * 60_000) / 2;
  return [new Date(inicio.getTime() - meia), new Date(fim.getTime() + meia)];
}

// O driver embrulha o erro do Postgres; percorre a cadeia de causas até achar o nome da restrição.
function restricaoViolada(erro: unknown): string | undefined {
  let atual = erro as { constraint?: string; code?: string; cause?: unknown } | undefined;
  for (let i = 0; atual && i < 5; i++) {
    if (atual.code === '23P01' || atual.constraint) return atual.constraint ?? '';
    atual = atual.cause as typeof atual;
  }
  return undefined;
}

export type NovaOcupacao = {
  espacoId: string;
  inicio: Date;
  fim: Date;
  /** 'prof:<id>' ou 'anfitriao' */
  ocupante: string;
  geraTrava: boolean;
  travaMinutos: number;
  reservaId?: string;
  bloqueioId?: string;
};

/**
 * Registra a ocupação. Quem decide se há conflito é o banco (restrições EXCLUDE); aqui só se
 * traduz a violação em erro de negócio. Chamar dentro de uma transação junto com a reserva
 * ou o bloqueio, para os dois nascerem (ou falharem) juntos.
 */
export async function registrarOcupacao(executor: Executor, o: NovaOcupacao): Promise<void> {
  const [iniTrava, fimTrava] = comTrava(o.inicio, o.fim, o.travaMinutos);
  try {
    await executor.insert(schema.ocupacao).values({
      espacoId: o.espacoId,
      periodo: intervalo(o.inicio, o.fim),
      periodoComTrava: intervalo(iniTrava, fimTrava),
      geraTrava: o.geraTrava,
      ocupante: o.ocupante,
      reservaId: o.reservaId,
      bloqueioId: o.bloqueioId,
    });
  } catch (erro) {
    const restricao = restricaoViolada(erro);
    if (restricao === 'ocupacao_sem_sobreposicao') throw new ConflitoAgendaError('sobreposicao');
    if (restricao === 'ocupacao_trava_entre_ocupantes') throw new ConflitoAgendaError('trava');
    throw erro;
  }
}
