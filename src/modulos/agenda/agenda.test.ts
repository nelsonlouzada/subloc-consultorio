import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db, pool, schema } from '@/db';
import { instanteLocal, partesLocais } from '@/lib/fuso';
import {
  criarBloqueio,
  criarBloqueiosRecorrentes,
  listarAgenda,
  removerBloqueio,
  removerGrupoBloqueios,
} from './bloqueio';
import { ConflitoAgendaError, registrarOcupacao } from './ocupacao';

// Testes de integração: usam o Postgres de verdade, porque o que se testa são as restrições
// EXCLUDE do banco. Cada teste cria o próprio espaço (as restrições valem por espaço) e tudo
// é apagado no fim.

const TRAVA = 60;
const usuarioId = `teste-agenda-${randomUUID()}`;
const espacosCriados: string[] = [];

// 2026-11-02 é uma segunda-feira. Cada teste usa o próprio espaço, então as datas podem se repetir.
const h = (hora: number, dia = 2) => instanteLocal(2026, 11, dia, hora);

async function novoEspaco(): Promise<string> {
  const [e] = await db
    .insert(schema.espaco)
    .values({ nome: 'Sala de teste', slug: `teste-${randomUUID()}` })
    .returning({ id: schema.espaco.id });
  espacosCriados.push(e.id);
  return e.id;
}

// Ocupa como um Profissional: cria a reserva e a ocupação na mesma transação, como o código de
// produção. O ocupante ('prof:A', 'prof:B') é o que as restrições comparam; a reserva usa um
// único Profissional de teste, porque o que importa aqui é a regra do banco.
function ocupar(espacoId: string, prof: string, ini: Date, fim: Date) {
  return db.transaction(async (tx) => {
    const [r] = await tx
      .insert(schema.reserva)
      .values({
        espacoId,
        profissionalId: usuarioId,
        inicio: ini,
        fim,
        unidade: 'hora',
        valorCheioCentavos: 5000,
        valorCentavos: 5000,
      })
      .returning({ id: schema.reserva.id });
    await registrarOcupacao(tx, {
      espacoId,
      inicio: ini,
      fim,
      ocupante: `prof:${prof}`,
      geraTrava: true,
      travaMinutos: TRAVA,
      reservaId: r.id,
    });
  });
}

const motivoDe = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ConflitoAgendaError ? e.motivo : `erro:${String(e)}`;
  }
};

beforeAll(async () => {
  await db.insert(schema.usuario).values({
    id: usuarioId,
    name: 'Teste Agenda',
    email: `${usuarioId}@example.com`,
    papel: 'anfitriao',
  });
  await db.insert(schema.profissional).values({
    usuarioId,
    cpf: usuarioId.replace(/\D/g, '').padEnd(11, '0').slice(0, 11) + randomUUID().slice(0, 4),
    profissao: 'psicologo',
    conselho: 'CRP',
    registroNumero: '00000',
    registroUf: 'SP',
  });
});

afterAll(async () => {
  // O espaço leva junto, em cascata, as reservas, os bloqueios e as ocupações de teste.
  if (espacosCriados.length) await db.delete(schema.espaco).where(inArray(schema.espaco.id, espacosCriados));
  await db.delete(schema.profissional).where(eq(schema.profissional.usuarioId, usuarioId));
  await db.delete(schema.usuario).where(eq(schema.usuario.id, usuarioId));
  await pool.end();
});

describe('trava de 1 hora entre ocupantes diferentes', () => {
  it('A 9h-10h trava 10h-11h: B só pode a partir das 11h', async () => {
    const e = await novoEspaco();
    await ocupar(e, 'A', h(9), h(10));
    expect(await motivoDe(ocupar(e, 'B', h(10), h(11)))).toBe('trava');
    expect(await motivoDe(ocupar(e, 'B', h(11), h(12)))).toBe('ok');
  });

  it('vale nos dois sentidos: com reserva às 11h, a hora 10h-11h não pode ser de outro', async () => {
    const e = await novoEspaco();
    await ocupar(e, 'A', h(11), h(12));
    expect(await motivoDe(ocupar(e, 'B', h(10), h(11)))).toBe('trava');
    expect(await motivoDe(ocupar(e, 'B', h(9), h(10)))).toBe('ok');
  });

  it('o mesmo Profissional emenda horas sem trava', async () => {
    const e = await novoEspaco();
    await ocupar(e, 'A', h(9), h(10));
    expect(await motivoDe(ocupar(e, 'A', h(10), h(11)))).toBe('ok');
  });

  it('turno 1 (07h-12h) e turno 2 (13h-22h) de pessoas diferentes cabem', async () => {
    const e = await novoEspaco();
    await ocupar(e, 'A', h(7), h(12));
    expect(await motivoDe(ocupar(e, 'B', h(13), h(22)))).toBe('ok');
  });

  it('a hora 12h-13h avulsa trava contra os dois turnos de outras pessoas', async () => {
    const e = await novoEspaco();
    await ocupar(e, 'A', h(7), h(12));
    expect(await motivoDe(ocupar(e, 'B', h(12), h(13)))).toBe('trava');
  });
});

describe('sobreposição', () => {
  it('rejeita períodos que se cruzam, mesmo do mesmo ocupante', async () => {
    const e = await novoEspaco();
    await ocupar(e, 'A', h(9), h(11));
    expect(await motivoDe(ocupar(e, 'A', h(10), h(12)))).toBe('sobreposicao');
  });

  it('espaços diferentes não interferem entre si', async () => {
    const e1 = await novoEspaco();
    const e2 = await novoEspaco();
    await ocupar(e1, 'A', h(9), h(10));
    expect(await motivoDe(ocupar(e2, 'B', h(9), h(10)))).toBe('ok');
  });
});

describe('bloqueios', () => {
  const base = (espacoId: string) => ({ espacoId, criadoPor: usuarioId, travaMinutos: TRAVA });

  it('uso próprio gera trava: Profissional só pode a partir de uma hora depois', async () => {
    const e = await novoEspaco();
    await criarBloqueio({ ...base(e), tipo: 'uso_proprio', inicio: h(9), fim: h(10) });
    expect(await motivoDe(ocupar(e, 'A', h(10), h(11)))).toBe('trava');
    expect(await motivoDe(ocupar(e, 'A', h(11), h(12)))).toBe('ok');
  });

  it('indisponível não gera trava, mas continua impedindo sobreposição', async () => {
    const e = await novoEspaco();
    await criarBloqueio({ ...base(e), tipo: 'indisponivel', inicio: h(9), fim: h(10) });
    expect(await motivoDe(ocupar(e, 'A', h(10), h(11)))).toBe('ok');
    expect(await motivoDe(ocupar(e, 'B', h(9), h(10)))).toBe('sobreposicao');
  });

  it('bloqueio em cima de reserva existente é recusado (o Anfitrião cancela a reserva antes)', async () => {
    const e = await novoEspaco();
    await ocupar(e, 'A', h(9), h(10));
    expect(await motivoDe(criarBloqueio({ ...base(e), tipo: 'indisponivel', inicio: h(9), fim: h(10) }))).toBe(
      'sobreposicao',
    );
  });

  it('bloqueio recusado não deixa linha pela metade (bloqueio e ocupação nascem juntos)', async () => {
    const e = await novoEspaco();
    await ocupar(e, 'A', h(9), h(10));
    await motivoDe(criarBloqueio({ ...base(e), tipo: 'indisponivel', inicio: h(9), fim: h(10) }));
    expect(await listarAgenda(e, h(0), h(24))).toHaveLength(0);
  });

  it('remover o bloqueio libera o horário', async () => {
    const e = await novoEspaco();
    const id = await criarBloqueio({ ...base(e), tipo: 'uso_proprio', inicio: h(9), fim: h(10) });
    expect(await motivoDe(ocupar(e, 'A', h(9), h(10)))).toBe('sobreposicao');
    await removerBloqueio(id);
    expect(await motivoDe(ocupar(e, 'A', h(9), h(10)))).toBe('ok');
  });

  it('fim antes do início é recusado', async () => {
    const e = await novoEspaco();
    await expect(criarBloqueio({ ...base(e), tipo: 'indisponivel', inicio: h(10), fim: h(9) })).rejects.toThrow();
  });
});

describe('concorrência', () => {
  it('dois pedidos simultâneos para o mesmo horário: só um passa', async () => {
    const e = await novoEspaco();
    const resultados = await Promise.all([
      motivoDe(ocupar(e, 'A', h(9), h(10))),
      motivoDe(ocupar(e, 'B', h(9), h(10))),
    ]);
    expect(resultados.filter((r) => r === 'ok')).toHaveLength(1);
    expect(resultados.filter((r) => r === 'sobreposicao' || r === 'trava')).toHaveLength(1);
  });

  it('dois pedidos simultâneos que se travam (9h e 10h, pessoas diferentes): só um passa', async () => {
    const e = await novoEspaco();
    const resultados = await Promise.all([
      motivoDe(ocupar(e, 'A', h(9), h(10))),
      motivoDe(ocupar(e, 'B', h(10), h(11))),
    ]);
    expect(resultados.filter((r) => r === 'ok')).toHaveLength(1);
    expect(resultados.filter((r) => r === 'trava')).toHaveLength(1);
  });

  it('vinte pedidos simultâneos no mesmo horário: exatamente um passa', async () => {
    const e = await novoEspaco();
    const resultados = await Promise.all(
      Array.from({ length: 20 }, (_, i) => motivoDe(ocupar(e, `P${i}`, h(9), h(10)))),
    );
    expect(resultados.filter((r) => r === 'ok')).toHaveLength(1);
    expect(resultados.filter((r) => r.startsWith('erro'))).toHaveLength(0);
  });
});

describe('bloqueios recorrentes', () => {
  const rec = (espacoId: string) => ({
    espacoId,
    tipo: 'uso_proprio' as const,
    criadoPor: usuarioId,
    travaMinutos: TRAVA,
    diasSemana: [1, 3], // segunda e quarta
    inicioHora: 7,
    fimHora: 12,
    dataInicio: { ano: 2026, mes: 11, dia: 2 },
    dataFim: { ano: 2026, mes: 11, dia: 15 },
  });

  it('"toda segunda e quarta, 07h-12h" por duas semanas cria 4 bloqueios no mesmo grupo', async () => {
    const e = await novoEspaco();
    const r = await criarBloqueiosRecorrentes(rec(e));
    expect(r.criados).toHaveLength(4);
    expect(r.conflitos).toHaveLength(0);
    const itens = await listarAgenda(e, h(0, 1), h(0, 20));
    expect(itens.map((i) => partesLocais(i.inicio).dia)).toEqual([2, 4, 9, 11]);
    expect(itens.every((i) => i.grupoId === r.grupoId)).toBe(true);
    expect(itens.every((i) => partesLocais(i.inicio).hora === 7 && partesLocais(i.fim).hora === 12)).toBe(true);
  });

  it('data que já está ocupada é pulada e informada, sem desfazer as outras', async () => {
    const e = await novoEspaco();
    await ocupar(e, 'A', h(8, 4), h(9, 4)); // quarta 04/11 ocupada
    const r = await criarBloqueiosRecorrentes(rec(e));
    expect(r.criados).toHaveLength(3);
    expect(r.conflitos).toEqual([{ data: '2026-11-04', motivo: 'sobreposicao' }]);
  });

  it('remover o grupo apaga todas as ocorrências', async () => {
    const e = await novoEspaco();
    const r = await criarBloqueiosRecorrentes(rec(e));
    await removerGrupoBloqueios(r.grupoId);
    expect(await listarAgenda(e, h(0, 1), h(0, 20))).toHaveLength(0);
  });

  it('período sem nenhum dia escolhido é recusado', async () => {
    const e = await novoEspaco();
    await expect(criarBloqueiosRecorrentes({ ...rec(e), diasSemana: [7], dataFim: { ano: 2026, mes: 11, dia: 7 } }))
      .rejects.toThrow();
  });
});

describe('fuso horário', () => {
  it('bloqueio até as 24h termina à meia-noite local, e o dia seguinte começa livre', async () => {
    const e = await novoEspaco();
    await criarBloqueio({
      espacoId: e,
      tipo: 'indisponivel',
      criadoPor: usuarioId,
      travaMinutos: TRAVA,
      inicio: h(22),
      fim: h(24),
    });
    const [item] = await listarAgenda(e, h(0), h(24));
    expect(item.fim.toISOString()).toBe('2026-11-03T03:00:00.000Z'); // 00h local = 03h UTC (UTC-3)
    expect(partesLocais(item.fim)).toMatchObject({ dia: 3, hora: 0 });
    expect(await motivoDe(ocupar(e, 'A', h(0, 3), h(1, 3)))).toBe('ok');
  });

  it('listar um dia local não puxa bloqueios do dia vizinho', async () => {
    const e = await novoEspaco();
    const base = { espacoId: e, tipo: 'indisponivel' as const, criadoPor: usuarioId, travaMinutos: TRAVA };
    await criarBloqueio({ ...base, inicio: h(22, 1), fim: h(24, 1) }); // domingo 01/11 à noite
    await criarBloqueio({ ...base, inicio: h(7, 2), fim: h(8, 2) }); // segunda 02/11 de manhã
    await criarBloqueio({ ...base, inicio: h(0, 3), fim: h(1, 3) }); // terça 03/11 de madrugada
    const dia2 = await listarAgenda(e, h(0, 2), h(24, 2));
    expect(dia2).toHaveLength(1);
    expect(partesLocais(dia2[0].inicio)).toMatchObject({ dia: 2, hora: 7 });
  });
});
