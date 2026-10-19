import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';

export const SLUG_SALA = 'sala';

/**
 * Cria a sala com as regras, turnos e preços iniciais (visao.md, seções 4.1 a 4.3 e 4.10).
 * Pode rodar quantas vezes quiser: se a sala já existe, não mexe em nada, para não
 * sobrescrever o que o Anfitrião ajustar depois. A tela de configuração completa vem na E6.
 */
export async function garantirEspacoInicial(): Promise<{ criado: boolean; espacoId: string }> {
  const [existente] = await db.select().from(schema.espaco).where(eq(schema.espaco.slug, SLUG_SALA));
  if (existente) return { criado: false, espacoId: existente.id };

  const espacoId = await db.transaction(async (tx) => {
    const [sala] = await tx
      .insert(schema.espaco)
      .values({
        nome: 'Sala de consultório',
        slug: SLUG_SALA,
        descricao: 'Sala de atendimento para profissionais de saúde mental, por hora, turno ou dia.',
      })
      .returning({ id: schema.espaco.id });

    await tx.insert(schema.regraEspaco).values({
      espacoId: sala.id,
      diasFuncionamento: [1, 2, 3, 4, 5, 6], // segunda a sábado; domingo fechado
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
    });

    const [turno1, turno2] = await tx
      .insert(schema.turno)
      .values([
        { espacoId: sala.id, nome: 'Turno 1', inicio: '07:00', fim: '12:00', ordem: 1 },
        { espacoId: sala.id, nome: 'Turno 2', inicio: '13:00', fim: '22:00', ordem: 2 },
      ])
      .returning({ id: schema.turno.id });

    await tx.insert(schema.preco).values([
      { espacoId: sala.id, unidade: 'hora', valorCentavos: 5000 },
      { espacoId: sala.id, unidade: 'turno', turnoId: turno1.id, valorCentavos: 20000 },
      { espacoId: sala.id, unidade: 'turno', turnoId: turno2.id, valorCentavos: 30000 },
      { espacoId: sala.id, unidade: 'dia', valorCentavos: 45000 },
    ]);
    return sala.id;
  });

  return { criado: true, espacoId };
}
