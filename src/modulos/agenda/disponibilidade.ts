import { and, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { partesLocais } from '@/lib/fuso';
import { comTrava, intervalo } from './ocupacao';

export type Regras = typeof schema.regraEspaco.$inferSelect;

export type MotivoIndisponivel =
  | 'horas_cheias'
  | 'duracao_minima'
  | 'fechado'
  | 'fora_do_horario'
  | 'antecedencia_minima'
  | 'antecedencia_maxima'
  | 'ocupado'
  | 'trava';

export const TEXTO_MOTIVO: Record<MotivoIndisponivel, string> = {
  horas_cheias: 'A reserva é em horas cheias.',
  duracao_minima: 'Abaixo da duração mínima.',
  fechado: 'A sala não abre neste dia.',
  fora_do_horario: 'Fora do horário de funcionamento.',
  antecedencia_minima: 'Pedido com pouca antecedência.',
  antecedencia_maxima: 'Muito longe: ainda não aceitamos reservas para esta data.',
  ocupado: 'Horário ocupado.',
  trava: 'Fica na hora de intervalo de outro ocupante.',
};

/** Uma ocupação já existente, com os dois intervalos que o banco compara. */
export type OcupacaoExistente = {
  inicio: Date;
  fim: Date;
  inicioComTrava: Date;
  fimComTrava: Date;
  geraTrava: boolean;
  ocupante: string;
};

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

const sobrepoe = (aIni: Date, aFim: Date, bIni: Date, bFim: Date) => aIni < bFim && bIni < aFim;

/** '07:00:00' -> 7 */
const horaDe = (tempo: string) => Number(tempo.slice(0, 2));

/**
 * Decide se um intervalo pode ser reservado por `ocupante`, aplicando as mesmas regras que o
 * banco aplica (sobreposição e trava) mais as regras de negócio (funcionamento, antecedência,
 * duração). Devolve o motivo da recusa, ou null se pode. O banco continua sendo o juiz final:
 * esta função serve para mostrar na tela só o que pode ser reservado e para recusar cedo.
 */
export function validarPedido(
  regras: Regras,
  ocupacoes: OcupacaoExistente[],
  ocupante: string,
  inicio: Date,
  fim: Date,
  agora: Date,
): MotivoIndisponivel | null {
  const duracao = fim.getTime() - inicio.getTime();
  const pIni = partesLocais(inicio);
  if (duracao <= 0 || duracao % HORA_MS !== 0 || pIni.minuto !== 0) return 'horas_cheias';
  const horas = duracao / HORA_MS;
  if (horas < regras.duracaoMinHoras) return 'duracao_minima';

  if (!regras.diasFuncionamento.includes(pIni.diaSemana)) return 'fechado';
  // Tem de caber no mesmo dia, dentro de abre-fecha.
  const horaFinal = pIni.hora + horas;
  if (pIni.hora < horaDe(regras.abre) || horaFinal > horaDe(regras.fecha)) return 'fora_do_horario';

  if (inicio.getTime() < agora.getTime() + regras.antecedenciaMinHoras * HORA_MS) return 'antecedencia_minima';
  if (inicio.getTime() > agora.getTime() + regras.antecedenciaMaxDias * DIA_MS) return 'antecedencia_maxima';

  const [iniTrava, fimTrava] = comTrava(inicio, fim, regras.travaMinutos);
  // 1) nada se sobrepõe, de ninguém
  if (ocupacoes.some((o) => sobrepoe(inicio, fim, o.inicio, o.fim))) return 'ocupado';
  // 2) trava entre ocupantes diferentes: as duas linhas precisam gerar trava
  if (
    ocupacoes.some(
      (o) => o.geraTrava && o.ocupante !== ocupante && sobrepoe(iniTrava, fimTrava, o.inicioComTrava, o.fimComTrava),
    )
  ) {
    return 'trava';
  }
  return null;
}

/** Ocupações do espaço que encostam na janela [de, ate), lidas como o banco as guarda. */
export async function carregarOcupacoes(espacoId: string, de: Date, ate: Date): Promise<OcupacaoExistente[]> {
  const linhas = await db
    .select({
      inicio: sql<Date>`lower(${schema.ocupacao.periodo})`,
      fim: sql<Date>`upper(${schema.ocupacao.periodo})`,
      inicioComTrava: sql<Date>`lower(${schema.ocupacao.periodoComTrava})`,
      fimComTrava: sql<Date>`upper(${schema.ocupacao.periodoComTrava})`,
      geraTrava: schema.ocupacao.geraTrava,
      ocupante: schema.ocupacao.ocupante,
    })
    .from(schema.ocupacao)
    .where(
      and(
        sql`${schema.ocupacao.espacoId} = ${espacoId}`,
        sql`${schema.ocupacao.periodoComTrava} && ${intervalo(de, ate)}::tstzrange`,
      ),
    );
  return linhas.map((l) => ({
    ...l,
    inicio: new Date(l.inicio),
    fim: new Date(l.fim),
    inicioComTrava: new Date(l.inicioComTrava),
    fimComTrava: new Date(l.fimComTrava),
  }));
}
