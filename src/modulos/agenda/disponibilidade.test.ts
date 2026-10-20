import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool, schema } from '@/db';
import { instanteLocal } from '@/lib/fuso';
import { criarBloqueio } from './bloqueio';
import { carregarOcupacoes, type Regras, validarPedido } from './disponibilidade';
import { ConflitoAgendaError, registrarOcupacao } from './ocupacao';

// Segunda-feira 02/11/2026. "Agora" fica 13 dias antes, dentro da janela de 60 dias.
const h = (hora: number, dia = 2) => instanteLocal(2026, 11, dia, hora);
const agora = instanteLocal(2026, 10, 20, 12);

const usuarioId = `teste-disp-${randomUUID()}`;
let espacoId: string;
let regras: Regras;

class Desfazer extends Error {}

/** O que o BANCO diz: tenta ocupar dentro de uma transação que sempre é desfeita. */
async function noBanco(ocupante: string, ini: Date, fim: Date): Promise<'ok' | 'ocupado' | 'trava'> {
  try {
    await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(schema.reserva)
        .values({ espacoId, profissionalId: usuarioId, inicio: ini, fim, unidade: 'hora', valorCheioCentavos: 5000, valorCentavos: 5000 })
        .returning({ id: schema.reserva.id });
      await registrarOcupacao(tx, { espacoId, inicio: ini, fim, ocupante, geraTrava: true, travaMinutos: regras.travaMinutos, reservaId: r.id });
      throw new Desfazer();
    });
  } catch (e) {
    if (e instanceof Desfazer) return 'ok';
    if (e instanceof ConflitoAgendaError) return e.motivo === 'sobreposicao' ? 'ocupado' : 'trava';
    throw e;
  }
  return 'ok';
}

beforeAll(async () => {
  await db.insert(schema.usuario).values({ id: usuarioId, name: 'Teste Disp', email: `${usuarioId}@example.com` });
  await db.insert(schema.profissional).values({
    usuarioId,
    cpf: `8${randomUUID().replace(/\D/g, '').padEnd(10, '0').slice(0, 10)}`,
    profissao: 'psicologo',
    conselho: 'CRP',
    registroNumero: '1',
    registroUf: 'SP',
    status: 'aprovado',
  });
  const [e] = await db.insert(schema.espaco).values({ nome: 'Sala', slug: `teste-${randomUUID()}` }).returning({ id: schema.espaco.id });
  espacoId = e.id;
  [regras] = await db
    .insert(schema.regraEspaco)
    .values({
      espacoId,
      diasFuncionamento: [1, 2, 3, 4, 5, 6],
      abre: '07:00',
      fecha: '22:00',
      antecedenciaMinHoras: 24,
      antecedenciaMaxDias: 60,
      duracaoMinHoras: 1,
      travaMinutos: 60,
      prazoAprovacaoHoras: 12,
      prazoPagamentoHoras: 2,
      corteAntesInicioHoras: 6,
      validadeCreditoDias: 90,
      descontoPacoteMesPct: 10,
      avisoRenovacaoSerieDias: 7,
      horaLembreteVespera: '18:00',
    })
    .returning();

  // Cenário do dia: A (profissional) 9h-10h; uso próprio 14h-15h (gera trava); indisponível 18h-19h (sem trava).
  await db.transaction(async (tx) => {
    const [r] = await tx
      .insert(schema.reserva)
      .values({ espacoId, profissionalId: usuarioId, inicio: h(9), fim: h(10), unidade: 'hora', valorCheioCentavos: 5000, valorCentavos: 5000 })
      .returning({ id: schema.reserva.id });
    await registrarOcupacao(tx, { espacoId, inicio: h(9), fim: h(10), ocupante: 'prof:A', geraTrava: true, travaMinutos: 60, reservaId: r.id });
  });
  await criarBloqueio({ espacoId, tipo: 'uso_proprio', inicio: h(14), fim: h(15), criadoPor: usuarioId, travaMinutos: 60 });
  await criarBloqueio({ espacoId, tipo: 'indisponivel', inicio: h(18), fim: h(19), criadoPor: usuarioId, travaMinutos: 60 });
});

afterAll(async () => {
  await db.delete(schema.espaco).where(eq(schema.espaco.id, espacoId)); // reservas, bloqueios e ocupações em cascata
  await db.delete(schema.profissional).where(eq(schema.profissional.usuarioId, usuarioId));
  await db.delete(schema.usuario).where(eq(schema.usuario.id, usuarioId));
  await pool.end();
});

describe('a disponibilidade concorda com o banco', () => {
  it.each(['prof:B', 'prof:A'])('para todo início e fim do dia, como %s', async (ocupante) => {
    const ocupacoes = await carregarOcupacoes(espacoId, h(0), h(24));
    expect(ocupacoes.length).toBe(3);
    let comparados = 0;
    for (let ini = 7; ini < 22; ini++) {
      for (let fim = ini + 1; fim <= 22; fim++) {
        const esperado = await noBanco(ocupante, h(ini), h(fim));
        const motivo = validarPedido(regras, ocupacoes, ocupante, h(ini), h(fim), agora);
        // As duas respostas precisam ser "pode" ou "não pode" ao mesmo tempo, em todas as combinações.
        expect({ ini, fim, pode: motivo === null }).toEqual({ ini, fim, pode: esperado === 'ok' });
        if (motivo) expect(['ocupado', 'trava']).toContain(motivo);
        comparados++;
      }
    }
    expect(comparados).toBe(120); // 15 inícios, de 22 combinações possíveis até 22h
  });
});

describe('regras de negócio', () => {
  const sem: never[] = [];
  const pede = (ini: Date, fim: Date, quando = agora) => validarPedido(regras, sem, 'prof:B', ini, fim, quando);

  it('aceita um horário comum dentro das regras', () => {
    expect(pede(h(9), h(10))).toBeNull();
  });

  it('só em horas cheias', () => {
    expect(pede(instanteLocal(2026, 11, 2, 9, 30), instanteLocal(2026, 11, 2, 10, 30))).toBe('horas_cheias');
    expect(pede(h(10), h(9))).toBe('horas_cheias');
  });

  it('domingo é fechado', () => {
    expect(pede(h(9, 1), h(10, 1))).toBe('fechado'); // 01/11/2026 é domingo
  });

  it('respeita 07h às 22h', () => {
    expect(pede(h(6), h(7))).toBe('fora_do_horario');
    expect(pede(h(21), h(23))).toBe('fora_do_horario');
    expect(pede(h(7), h(22))).toBeNull();
  });

  it('antecedência mínima de 24 horas', () => {
    const quando = instanteLocal(2026, 11, 1, 10); // véspera às 10h
    expect(pede(h(9), h(10), quando)).toBe('antecedencia_minima'); // faltam 23h
    expect(pede(h(11), h(12), quando)).toBeNull(); // faltam exatamente 25h
    expect(pede(h(10), h(11), quando)).toBeNull(); // exatamente 24h: pode
  });

  it('antecedência máxima de 60 dias', () => {
    expect(pede(instanteLocal(2026, 12, 19, 9), instanteLocal(2026, 12, 19, 10))).toBeNull(); // 60 dias e poucas horas à frente
    expect(pede(instanteLocal(2026, 12, 28, 9), instanteLocal(2026, 12, 28, 10))).toBe('antecedencia_maxima');
  });

  it('respeita a duração mínima configurada', () => {
    expect(validarPedido({ ...regras, duracaoMinHoras: 2 }, sem, 'prof:B', h(9), h(10), agora)).toBe('duracao_minima');
    expect(validarPedido({ ...regras, duracaoMinHoras: 2 }, sem, 'prof:B', h(9), h(11), agora)).toBeNull();
  });

  it('usa a trava configurada, não um valor fixo', async () => {
    const ocupacoes = await carregarOcupacoes(espacoId, h(0), h(24));
    // Com trava de 60 min, 10h-11h é negado para B (A ocupa 9h-10h); sem trava, passaria.
    expect(validarPedido(regras, ocupacoes, 'prof:B', h(10), h(11), agora)).toBe('trava');
  });
});
