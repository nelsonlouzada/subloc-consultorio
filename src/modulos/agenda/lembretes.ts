import { and, eq, gte, lt } from 'drizzle-orm';
import { db, schema } from '@/db';
import { partesLocais, somarDias } from '@/lib/fuso';
import { emailLembreteVespera } from '@/modulos/comunicacao/modelos';
import { notificar } from '@/modulos/comunicacao/notificar';
import { descreverPeriodo, hojeLocal, limitesDoDia } from './calendario';

/**
 * Lembrete da véspera (D6): na hora configurada (padrão 18h, hora da sala), avisa quem tem
 * reserva confirmada amanhã. Pode rodar quantas vezes quiser no dia: `notificar` não deixa o
 * mesmo lembrete sair duas vezes, então o worker só precisa chamar de hora em hora.
 */
export async function enviarLembretesDaVespera(agora = new Date()): Promise<{ enviados: number }> {
  const salas = await db
    .select({ espacoId: schema.regraEspaco.espacoId, hora: schema.regraEspaco.horaLembreteVespera })
    .from(schema.regraEspaco)
    .innerJoin(schema.espaco, eq(schema.espaco.id, schema.regraEspaco.espacoId))
    .where(eq(schema.espaco.ativo, true));

  const local = partesLocais(agora);
  const [amanhaIni, amanhaFim] = limitesDoDia(somarDias(hojeLocal(agora), 1));
  let enviados = 0;

  for (const sala of salas) {
    const [hh, mm] = sala.hora.split(':').map(Number);
    if (local.hora * 60 + local.minuto < hh * 60 + mm) continue; // ainda não é a hora do lembrete

    const reservas = await db
      .select({
        id: schema.reserva.id,
        inicio: schema.reserva.inicio,
        fim: schema.reserva.fim,
        codigo: schema.reserva.codigoAcesso,
        profissionalId: schema.reserva.profissionalId,
        nome: schema.usuario.name,
        email: schema.usuario.email,
      })
      .from(schema.reserva)
      .innerJoin(schema.usuario, eq(schema.usuario.id, schema.reserva.profissionalId))
      .where(
        and(
          eq(schema.reserva.espacoId, sala.espacoId),
          eq(schema.reserva.status, 'confirmada'),
          gte(schema.reserva.inicio, amanhaIni),
          lt(schema.reserva.inicio, amanhaFim),
        ),
      );

    for (const r of reservas) {
      const m = emailLembreteVespera({ nome: r.nome, periodo: descreverPeriodo(r.inicio, r.fim), codigo: r.codigo, reservaId: r.id });
      const resultado = await notificar({
        usuarioId: r.profissionalId,
        para: r.email,
        tipo: 'lembrete_vespera',
        assunto: m.assunto,
        html: m.html,
        referenciaTipo: 'reserva',
        referenciaId: r.id,
      });
      if (resultado === 'enviado') enviados++;
    }
  }
  return { enviados };
}
