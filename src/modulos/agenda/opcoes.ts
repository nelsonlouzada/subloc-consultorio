import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { type DataLocal, instanteLocal } from '@/lib/fuso';
import { carregarTabelaPrecos } from '@/modulos/configuracao/precos';
import { carregarOcupacoes, type MotivoIndisponivel, validarPedido } from './disponibilidade';
import { calcularPreco } from './preco';

export type OpcaoTurno = {
  id: string;
  nome: string;
  inicio: number;
  fim: number;
  centavos: number;
  motivo: MotivoIndisponivel | null;
};

export type OpcoesDoDia = {
  /** A sala abre neste dia da semana. */
  aberto: boolean;
  abre: number;
  fecha: number;
  horaCentavos: number;
  /** Cada hora avulsa do dia e por que não dá (null = pode). */
  horas: { hora: number; motivo: MotivoIndisponivel | null }[];
  /** Para cada hora inicial possível, as horas finais possíveis (colando horas livres em sequência). */
  fimsPorInicio: Record<number, number[]>;
  turnos: OpcaoTurno[];
  diaInteiro: { inicio: number; fim: number; centavos: number; motivo: MotivoIndisponivel | null };
};

/**
 * O que o Profissional pode reservar num dia: cada hora, cada turno e o dia inteiro, já com o
 * motivo quando não dá. Usa a mesma conferência da criação da reserva (validarPedido), então
 * a tela só oferece o que o servidor vai aceitar (o banco ainda decide em caso de corrida).
 */
export async function opcoesDoDia(
  espacoId: string,
  profissionalId: string,
  dia: DataLocal,
  agora = new Date(),
): Promise<OpcoesDoDia | null> {
  const [regras] = await db.select().from(schema.regraEspaco).where(eq(schema.regraEspaco.espacoId, espacoId));
  if (!regras) return null;

  const abre = Number(regras.abre.slice(0, 2));
  const fecha = Number(regras.fecha.slice(0, 2));
  const h = (hora: number) => instanteLocal(dia.ano, dia.mes, dia.dia, hora);
  const tabela = await carregarTabelaPrecos(espacoId);
  const ocupacoes = await carregarOcupacoes(espacoId, h(abre - 24), h(fecha + 24));
  const ocupante = `prof:${profissionalId}`;
  const checa = (ini: number, fim: number) => validarPedido(regras, ocupacoes, ocupante, h(ini), h(fim), agora);

  const horas = Array.from({ length: fecha - abre }, (_, i) => ({ hora: abre + i, motivo: checa(abre + i, abre + i + 1) }));
  const fimsPorInicio: Record<number, number[]> = {};
  for (const { hora, motivo } of horas) {
    if (motivo) continue;
    const fins: number[] = [];
    for (let fim = hora + 1; fim <= fecha && checa(hora, fim) === null; fim++) fins.push(fim);
    fimsPorInicio[hora] = fins;
  }

  const preco = (ini: number, fim: number) => calcularPreco(h(ini), h(fim), tabela).valorCentavos;
  return {
    aberto: horas.some((x) => x.motivo !== 'fechado'),
    abre,
    fecha,
    horaCentavos: tabela.horaCentavos,
    horas,
    fimsPorInicio,
    turnos: tabela.turnos.map((t) => ({
      id: t.id,
      nome: t.nome,
      inicio: t.inicio,
      fim: t.fim,
      centavos: preco(t.inicio, t.fim),
      motivo: checa(t.inicio, t.fim),
    })),
    diaInteiro: { inicio: abre, fim: fecha, centavos: preco(abre, fecha), motivo: checa(abre, fecha) },
  };
}
