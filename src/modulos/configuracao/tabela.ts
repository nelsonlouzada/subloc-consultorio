import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@/db';
import { reaisParaCentavos } from '@/lib/dinheiro';
import { dataISOValida, instanteLocal, parseDataISO, partesLocais } from '@/lib/fuso';
import { horaInteira } from './espaco';

/** Preços e turnos da sala (T26). Preço novo vale a partir de uma data e nunca altera reservas já feitas. */

const MAX_CENTAVOS = 10_000_000; // R$ 100 mil: barra erro de digitação, não negócio

export const TEXTO_ERRO_TABELA: Record<string, string> = {
  valor: 'Confira os valores: use números como 80 ou 80,50, maiores que zero.',
  data: 'A data de início dos preços precisa existir, não pode ser passada e fica a até 1 ano.',
  nome: 'Todo turno precisa de um nome (até 40 letras).',
  horario: 'Em cada turno, o início precisa ser antes do fim.',
  funcionamento: 'Os turnos precisam ficar dentro do horário de funcionamento da sala.',
  sobreposicao: 'Dois turnos ativos não podem ocupar o mesmo horário.',
  sem_turno: 'Deixe pelo menos um turno ativo.',
  invalido: 'Não foi possível ler o formulário.',
};
export type ErroTabela = keyof typeof TEXTO_ERRO_TABELA;

// ---------------------------------------------------------------------------
// Preços
// ---------------------------------------------------------------------------

/** O relógio do banco, o mesmo que grava `vigente_desde`; o da aplicação pode divergir alguns milissegundos. */
async function agoraDoBanco(exec: Pick<typeof db, 'execute'>): Promise<Date> {
  const [{ agora }] = (await exec.execute(sql`select now() as agora`)).rows as { agora: string | Date }[];
  return new Date(agora);
}

export type EntradaPrecos = {
  hora: string;
  dia: string;
  /** turnoId -> valor em reais, como digitado */
  turnos: Record<string, string>;
  /** AAAA-MM-DD; vazio = a partir de agora */
  desde?: string;
};

export type ItemPreco = { chave: string; nome: string; vigenteCentavos: number; agendado: { centavos: number; desde: Date } | null };

/** Os preços como a tela os mostra: o vigente agora e, se houver, a mudança agendada. */
export async function carregarPrecosParaTela(espacoId: string): Promise<{ hora: ItemPreco; dia: ItemPreco; turnos: (ItemPreco & { turnoId: string })[] }> {
  const agora = await agoraDoBanco(db);
  const turnos = await db
    .select()
    .from(schema.turno)
    .where(and(eq(schema.turno.espacoId, espacoId), eq(schema.turno.ativo, true)))
    .orderBy(asc(schema.turno.ordem));
  const linhas = await db.select().from(schema.preco).where(eq(schema.preco.espacoId, espacoId));

  const item = (chave: string, nome: string, unidade: 'hora' | 'dia' | 'turno', turnoId: string | null): ItemPreco => {
    const minhas = linhas.filter((l) => l.unidade === unidade && l.turnoId === turnoId).sort((a, b) => b.vigenteDesde.getTime() - a.vigenteDesde.getTime());
    const vigente = minhas.find((l) => l.vigenteDesde <= agora);
    const futura = [...minhas].reverse().find((l) => l.vigenteDesde > agora);
    return {
      chave,
      nome,
      vigenteCentavos: vigente?.valorCentavos ?? 0,
      agendado: futura ? { centavos: futura.valorCentavos, desde: futura.vigenteDesde } : null,
    };
  };

  return {
    hora: item('hora', 'Hora', 'hora', null),
    dia: item('dia', 'Dia inteiro', 'dia', null),
    turnos: turnos.map((t) => ({ ...item(`turno:${t.id}`, t.nome, 'turno', t.id), turnoId: t.id })),
  };
}

function dataDeInicio(desde: string | undefined, agora: Date): { ok: true; quando: Date | null } | { ok: false } {
  const texto = (desde ?? '').trim();
  if (!texto) return { ok: true, quando: null };
  if (!dataISOValida(texto)) return { ok: false };
  const d = parseDataISO(texto);
  const quando = instanteLocal(d.ano, d.mes, d.dia, 0);
  const hoje = partesLocais(agora);
  const inicioDeHoje = instanteLocal(hoje.ano, hoje.mes, hoje.dia, 0);
  if (quando < inicioDeHoje || quando.getTime() - agora.getTime() > 366 * 86_400_000) return { ok: false };
  return { ok: true, quando };
}

/**
 * Grava os preços que mudaram. Cada mudança é uma linha nova com a data de início, então o
 * histórico fica e as reservas existentes não mudam. Salvar de novo com a mesma data troca o que
 * estava agendado a partir dela.
 */
export async function salvarPrecos(espacoId: string, usuarioId: string, entrada: EntradaPrecos, ip?: string | null) {
  const hora = reaisParaCentavos(entrada.hora);
  const dia = reaisParaCentavos(entrada.dia);
  const porTurno = Object.entries(entrada.turnos).map(([id, v]) => [id, reaisParaCentavos(v)] as const);
  const valores = [hora, dia, ...porTurno.map(([, v]) => v)];
  if (valores.some((v) => v === null || v <= 0 || v > MAX_CENTAVOS)) return { ok: false as const, erro: 'valor' as ErroTabela };

  return db.transaction(async (tx) => {
    const agora = await agoraDoBanco(tx);
    const inicio = dataDeInicio(entrada.desde, agora);
    if (!inicio.ok) return { ok: false as const, erro: 'data' as ErroTabela };
    const quando = inicio.quando ?? agora;

    const turnos = await tx.select().from(schema.turno).where(and(eq(schema.turno.espacoId, espacoId), eq(schema.turno.ativo, true)));
    const nomeDe = new Map(turnos.map((t) => [t.id, t.nome]));
    if (porTurno.some(([id]) => !nomeDe.has(id))) return { ok: false as const, erro: 'valor' as ErroTabela };

    const linhas = await tx.select().from(schema.preco).where(eq(schema.preco.espacoId, espacoId));
    const mudancas: { item: string; antes: number | null; depois: number }[] = [];

    const aplicar = async (nomeItem: string, unidade: 'hora' | 'dia' | 'turno', turnoId: string | null, centavos: number) => {
      const minhas = linhas.filter((l) => l.unidade === unidade && l.turnoId === turnoId);
      // Linhas que começam na própria data (ou depois) são substituídas pela nova; o valor "de antes" vem das anteriores.
      const vigenteEm = minhas.filter((l) => l.vigenteDesde < quando).sort((a, b) => b.vigenteDesde.getTime() - a.vigenteDesde.getTime())[0];
      const depois = minhas.filter((l) => l.vigenteDesde >= quando);
      if (vigenteEm?.valorCentavos === centavos && depois.length === 0) return;

      if (depois.length) await tx.delete(schema.preco).where(inArray(schema.preco.id, depois.map((l) => l.id)));
      if (vigenteEm?.valorCentavos !== centavos) {
        await tx.insert(schema.preco).values({ espacoId, unidade, turnoId, valorCentavos: centavos, vigenteDesde: quando });
      }
      mudancas.push({ item: nomeItem, antes: vigenteEm?.valorCentavos ?? null, depois: centavos });
    };

    await aplicar('hora', 'hora', null, hora!);
    await aplicar('dia', 'dia', null, dia!);
    for (const [id, v] of porTurno) await aplicar(`turno:${nomeDe.get(id)}`, 'turno', id, v!);

    if (mudancas.length) {
      await tx.insert(schema.eventoAuditoria).values({
        usuarioId,
        acao: 'precos_alterados',
        entidade: 'espaco',
        entidadeId: espacoId,
        dados: { desde: quando.toISOString(), mudancas },
        ip: ip ?? null,
      });
    }
    return { ok: true as const, mudancas: mudancas.length, agendado: quando > agora };
  });
}

// ---------------------------------------------------------------------------
// Turnos
// ---------------------------------------------------------------------------

export type TurnoEditavel = { id?: string; nome: string; inicio: number; fim: number; ativo: boolean };
export type NovoTurno = { nome: string; inicio: number; fim: number; valor: string };

export async function carregarTurnosParaTela(espacoId: string) {
  const turnos = await db.select().from(schema.turno).where(eq(schema.turno.espacoId, espacoId)).orderBy(asc(schema.turno.ordem));
  return turnos.map((t) => ({ id: t.id, nome: t.nome, inicio: horaInteira(t.inicio), fim: horaInteira(t.fim), ativo: t.ativo }));
}

const hhmm = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Confere a lista de turnos (a existente, editada, mais um novo opcional) contra o horário de funcionamento. */
export function validarTurnos(turnos: TurnoEditavel[], novo: NovoTurno | null, abre: number, fecha: number): ErroTabela | null {
  const todos = [...turnos, ...(novo ? [{ ...novo, ativo: true }] : [])];
  for (const t of todos) {
    const nome = t.nome.trim();
    if (!nome || nome.length > 40) return 'nome';
    if (!Number.isInteger(t.inicio) || !Number.isInteger(t.fim) || t.inicio < 0 || t.fim > 24 || t.inicio >= t.fim) return 'horario';
  }
  const ativos = todos.filter((t) => t.ativo).sort((a, b) => a.inicio - b.inicio);
  if (ativos.length === 0) return 'sem_turno';
  if (ativos.some((t) => t.inicio < abre || t.fim > fecha)) return 'funcionamento';
  for (let i = 1; i < ativos.length; i++) if (ativos[i].inicio < ativos[i - 1].fim) return 'sobreposicao';
  if (novo) {
    const v = reaisParaCentavos(novo.valor);
    if (v === null || v <= 0 || v > MAX_CENTAVOS) return 'valor';
  }
  return null;
}

/**
 * Grava nome, horário e situação dos turnos, e cria um turno novo com o preço dele. Turno antigo
 * nunca é apagado (reservas e séries apontam para ele): fica inativo.
 */
export async function salvarTurnos(espacoId: string, usuarioId: string, turnos: TurnoEditavel[], novo: NovoTurno | null, ip?: string | null) {
  return db.transaction(async (tx) => {
    const [regras] = await tx.select().from(schema.regraEspaco).where(eq(schema.regraEspaco.espacoId, espacoId));
    if (!regras) throw new Error('A sala não tem regras cadastradas.');
    const erro = validarTurnos(turnos, novo, horaInteira(regras.abre), horaInteira(regras.fecha));
    if (erro) return { ok: false as const, erro };

    const atuais = await tx.select().from(schema.turno).where(eq(schema.turno.espacoId, espacoId));
    const porId = new Map(atuais.map((t) => [t.id, t]));
    if (turnos.some((t) => !t.id || !porId.has(t.id)) || turnos.length !== atuais.length) return { ok: false as const, erro: 'invalido' as ErroTabela };

    const mudancas: { turno: string; antes: unknown; depois: unknown }[] = [];
    for (const t of turnos) {
      const a = porId.get(t.id!)!;
      const antes = { nome: a.nome, inicio: horaInteira(a.inicio), fim: horaInteira(a.fim), ativo: a.ativo };
      const depois = { nome: t.nome.trim(), inicio: t.inicio, fim: t.fim, ativo: t.ativo };
      if (JSON.stringify(antes) === JSON.stringify(depois)) continue;
      await tx
        .update(schema.turno)
        .set({ nome: depois.nome, inicio: hhmm(depois.inicio), fim: hhmm(depois.fim), ativo: depois.ativo })
        .where(eq(schema.turno.id, t.id!));
      mudancas.push({ turno: a.nome, antes, depois });
    }

    if (novo) {
      const ordem = Math.max(0, ...atuais.map((t) => t.ordem)) + 1;
      const [criado] = await tx
        .insert(schema.turno)
        .values({ espacoId, nome: novo.nome.trim(), inicio: hhmm(novo.inicio), fim: hhmm(novo.fim), ordem })
        .returning({ id: schema.turno.id });
      await tx.insert(schema.preco).values({ espacoId, unidade: 'turno', turnoId: criado.id, valorCentavos: reaisParaCentavos(novo.valor)! });
      mudancas.push({ turno: novo.nome.trim(), antes: null, depois: { inicio: novo.inicio, fim: novo.fim, valor: reaisParaCentavos(novo.valor) } });
    }

    // A ordem na tela acompanha o horário.
    const ordenados = await tx.select().from(schema.turno).where(eq(schema.turno.espacoId, espacoId));
    ordenados.sort((a, b) => a.inicio.localeCompare(b.inicio));
    for (const [i, t] of ordenados.entries()) if (t.ordem !== i + 1) await tx.update(schema.turno).set({ ordem: i + 1 }).where(eq(schema.turno.id, t.id));

    if (mudancas.length) {
      await tx.insert(schema.eventoAuditoria).values({ usuarioId, acao: 'turnos_alterados', entidade: 'espaco', entidadeId: espacoId, dados: { mudancas }, ip: ip ?? null });
    }
    return { ok: true as const, mudancas: mudancas.length };
  });
}
