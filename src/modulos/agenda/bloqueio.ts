import { randomUUID } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { db, schema } from '@/db';
import {
  type DataLocal,
  diaSemanaDe,
  formatarDataISO,
  instanteLocal,
  somarDias,
} from '@/lib/fuso';
import { ConflitoAgendaError, type Executor, type MotivoConflito, registrarOcupacao } from './ocupacao';

export type TipoBloqueio = 'uso_proprio' | 'indisponivel';

export type NovoBloqueio = {
  espacoId: string;
  tipo: TipoBloqueio;
  inicio: Date;
  fim: Date;
  motivo?: string | null;
  grupoId?: string | null;
  criadoPor: string;
  travaMinutos: number;
};

// Uso próprio (atendimentos da esposa) conta como um ocupante e gera a trava de antes e depois.
// Indisponível (manutenção, feriado, folga) só fecha o horário, sem trava (visao.md, 4.7).
async function inserirBloqueio(executor: Executor, b: NovoBloqueio): Promise<string> {
  if (b.fim <= b.inicio) throw new Error('O fim do bloqueio precisa ser depois do início.');
  const [criado] = await executor
    .insert(schema.bloqueio)
    .values({
      espacoId: b.espacoId,
      tipo: b.tipo,
      inicio: b.inicio,
      fim: b.fim,
      motivo: b.motivo ?? null,
      grupoId: b.grupoId ?? null,
      criadoPor: b.criadoPor,
    })
    .returning({ id: schema.bloqueio.id });

  await registrarOcupacao(executor, {
    espacoId: b.espacoId,
    inicio: b.inicio,
    fim: b.fim,
    ocupante: 'anfitriao',
    geraTrava: b.tipo === 'uso_proprio',
    travaMinutos: b.travaMinutos,
    bloqueioId: criado.id,
  });
  return criado.id;
}

/** Cria um bloqueio avulso. Lança ConflitoAgendaError se o horário não couber. */
export async function criarBloqueio(b: NovoBloqueio): Promise<string> {
  return db.transaction((tx) => inserirBloqueio(tx, b));
}

export type BloqueioRecorrente = Omit<NovoBloqueio, 'inicio' | 'fim' | 'grupoId'> & {
  /** 1 = segunda ... 7 = domingo */
  diasSemana: number[];
  /** Horas cheias em hora local da sala: 7 e 12 = 07h às 12h. fimHora pode ser 24. */
  inicioHora: number;
  fimHora: number;
  dataInicio: DataLocal;
  dataFim: DataLocal;
};

export type ResultadoRecorrencia = {
  grupoId: string;
  criados: string[];
  conflitos: { data: string; motivo: MotivoConflito }[];
};

const MAX_OCORRENCIAS = 400;

/**
 * Cria um bloqueio por data ("toda segunda e quarta, 07h-12h"). Datas que batem em algo já
 * ocupado são puladas e devolvidas em `conflitos`, sem desfazer as demais (savepoint por data).
 */
export async function criarBloqueiosRecorrentes(b: BloqueioRecorrente): Promise<ResultadoRecorrencia> {
  if (b.diasSemana.length === 0) throw new Error('Escolha ao menos um dia da semana.');
  if (b.fimHora <= b.inicioHora) throw new Error('A hora final precisa ser depois da inicial.');

  const grupoId = randomUUID();
  const datas: DataLocal[] = [];
  for (let d = b.dataInicio, i = 0; ; d = somarDias(d, 1), i++) {
    if (formatarDataISO(d) > formatarDataISO(b.dataFim)) break;
    if (i > 366) throw new Error('O período da repetição não pode passar de um ano.');
    if (b.diasSemana.includes(diaSemanaDe(d))) datas.push(d);
  }
  if (datas.length === 0) throw new Error('Nenhuma data do período cai nos dias escolhidos.');
  if (datas.length > MAX_OCORRENCIAS) throw new Error('Repetição grande demais.');

  return db.transaction(async (tx) => {
    const resultado: ResultadoRecorrencia = { grupoId, criados: [], conflitos: [] };
    for (const d of datas) {
      const inicio = instanteLocal(d.ano, d.mes, d.dia, b.inicioHora);
      const fim = instanteLocal(d.ano, d.mes, d.dia, b.fimHora);
      try {
        const id = await tx.transaction((sp) => inserirBloqueio(sp, { ...b, inicio, fim, grupoId }));
        resultado.criados.push(id);
      } catch (e) {
        if (!(e instanceof ConflitoAgendaError)) throw e;
        resultado.conflitos.push({ data: formatarDataISO(d), motivo: e.motivo });
      }
    }
    return resultado;
  });
}

/** Remove um bloqueio; a ocupação some junto (chave estrangeira em cascata). */
export async function removerBloqueio(id: string): Promise<void> {
  await db.delete(schema.bloqueio).where(eq(schema.bloqueio.id, id));
}

/** Remove todos os bloqueios criados juntos por uma repetição. Devolve quantos foram apagados. */
export async function removerGrupoBloqueios(grupoId: string): Promise<number> {
  const apagados = await db
    .delete(schema.bloqueio)
    .where(eq(schema.bloqueio.grupoId, grupoId))
    .returning({ id: schema.bloqueio.id });
  return apagados.length;
}

export type ItemAgenda = {
  id: string;
  origem: 'bloqueio';
  tipo: TipoBloqueio;
  inicio: Date;
  fim: Date;
  motivo: string | null;
  grupoId: string | null;
};

/** Tudo que ocupa a sala num período [de, ate). As reservas entram aqui na E2. */
export async function listarAgenda(espacoId: string, de: Date, ate: Date): Promise<ItemAgenda[]> {
  const linhas = await db
    .select()
    .from(schema.bloqueio)
    .where(and(eq(schema.bloqueio.espacoId, espacoId), lt(schema.bloqueio.inicio, ate), gt(schema.bloqueio.fim, de)))
    .orderBy(schema.bloqueio.inicio);
  return linhas.map((l) => ({
    id: l.id,
    origem: 'bloqueio',
    tipo: l.tipo,
    inicio: l.inicio,
    fim: l.fim,
    motivo: l.motivo,
    grupoId: l.grupoId,
  }));
}
