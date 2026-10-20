import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db, schema } from '@/db';

/**
 * Dados de teste para os testes de integração. Cada teste cria o que precisa e `limpar()` apaga
 * tudo na ordem certa das dependências (cobranças e aceites antes das reservas; cadastros antes
 * dos usuários). Nada toca a sala real do banco local.
 */
export function fabrica() {
  const sufixo = randomUUID().slice(0, 8);
  const usuarios: string[] = [];
  const espacos: string[] = [];
  let n = 0;

  async function usuario(papel: 'anfitriao' | 'profissional') {
    const id = `teste-fab-${sufixo}-${++n}`;
    usuarios.push(id);
    await db.insert(schema.usuario).values({ id, name: `${papel === 'anfitriao' ? 'Anfitrião' : 'Profissional'} ${n}`, email: `${id}@example.com`, papel });
    return id;
  }

  return {
    anfitriao: () => usuario('anfitriao'),

    async profissional(status: 'pendente' | 'aprovado' | 'recusado' | 'bloqueado' = 'aprovado') {
      const id = await usuario('profissional');
      await db.insert(schema.profissional).values({
        usuarioId: id,
        cpf: `5${sufixo.replace(/\D/g, '0').padEnd(4, '0').slice(0, 4)}${String(n).padStart(6, '0')}`,
        profissao: 'psicologo',
        conselho: 'CRP',
        registroNumero: String(n),
        registroUf: 'SP',
        status,
      });
      return id;
    },

    /** Sala completa: regras, turnos 07-12 e 13-22 e preços (hora 50, turnos 200/300, dia 450). */
    async sala(ajustes: Partial<typeof schema.regraEspaco.$inferInsert> = {}) {
      const [e] = await db.insert(schema.espaco).values({ nome: 'Sala de teste', slug: `teste-${randomUUID()}` }).returning({ id: schema.espaco.id });
      espacos.push(e.id);
      await db.insert(schema.regraEspaco).values({
        espacoId: e.id,
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
        ...ajustes,
      });
      const [t1, t2] = await db
        .insert(schema.turno)
        .values([
          { espacoId: e.id, nome: 'Turno 1', inicio: '07:00', fim: '12:00', ordem: 1 },
          { espacoId: e.id, nome: 'Turno 2', inicio: '13:00', fim: '22:00', ordem: 2 },
        ])
        .returning({ id: schema.turno.id });
      await db.insert(schema.preco).values([
        { espacoId: e.id, unidade: 'hora', valorCentavos: 5000 },
        { espacoId: e.id, unidade: 'turno', turnoId: t1.id, valorCentavos: 20000 },
        { espacoId: e.id, unidade: 'turno', turnoId: t2.id, valorCentavos: 30000 },
        { espacoId: e.id, unidade: 'dia', valorCentavos: 45000 },
      ]);
      return { espacoId: e.id, turno1: t1.id, turno2: t2.id };
    },

    async limpar() {
      const reservas = espacos.length
        ? await db.select({ id: schema.reserva.id }).from(schema.reserva).where(inArray(schema.reserva.espacoId, espacos))
        : [];
      const reservaIds = reservas.map((r) => r.id);
      const referencias = [...reservaIds, ...usuarios];
      if (referencias.length) await db.delete(schema.notificacao).where(inArray(schema.notificacao.referenciaId, referencias));
      if (usuarios.length) {
        await db.delete(schema.notificacao).where(inArray(schema.notificacao.usuarioId, usuarios));
        await db.delete(schema.creditoLote).where(inArray(schema.creditoLote.profissionalId, usuarios)); // movimentos em cascata
        const cobrancas = await db.select({ id: schema.cobranca.id }).from(schema.cobranca).where(inArray(schema.cobranca.profissionalId, usuarios));
        if (cobrancas.length) await db.delete(schema.recibo).where(inArray(schema.recibo.cobrancaId, cobrancas.map((c) => c.id)));
        await db.delete(schema.cobranca).where(inArray(schema.cobranca.profissionalId, usuarios)); // itens em cascata
        await db.delete(schema.aceite).where(inArray(schema.aceite.usuarioId, usuarios));
        await db.delete(schema.eventoAuditoria).where(inArray(schema.eventoAuditoria.usuarioId, usuarios));
      }
      if (referencias.length) await db.delete(schema.eventoAuditoria).where(inArray(schema.eventoAuditoria.entidadeId, referencias));
      for (const e of espacos) await db.delete(schema.espaco).where(eq(schema.espaco.id, e)); // reservas, ocupações, bloqueios
      if (usuarios.length) {
        await db.delete(schema.profissional).where(inArray(schema.profissional.usuarioId, usuarios));
        await db.delete(schema.usuario).where(inArray(schema.usuario.id, usuarios));
      }
    },
  };
}
