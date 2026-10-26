import Link from 'next/link';
import { and, asc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { formatarDataISO, somarDias } from '@/lib/fuso';
import { exigirProfissional } from '@/lib/sessao';
import { hojeLocal } from '@/modulos/agenda/calendario';
import { TEXTO_ERRO_SERIE, type ErroSerie } from '@/modulos/agenda/serie';
import { carregarSala, horaInteira } from '@/modulos/configuracao/espaco';
import FormularioSerie from './FormularioSerie';
import type { ParametrosSerie } from './pedido-serie';

export const metadata = { title: 'Reservar um horário fixo' };

const lista = (v?: string | string[]) => (Array.isArray(v) ? v : v ? [v] : []);

export default async function ReservarSerie({ searchParams }: { searchParams: Promise<ParametrosSerie> }) {
  const { profissional } = await exigirProfissional();
  const busca = await searchParams;
  const sala = await carregarSala();
  const podePedir = profissional.status === 'pendente' || profissional.status === 'aprovado';
  const hoje = hojeLocal();

  const turnos = sala
    ? await db
        .select()
        .from(schema.turno)
        .where(and(eq(schema.turno.espacoId, sala.espaco.id), eq(schema.turno.ativo, true)))
        .orderBy(asc(schema.turno.ordem))
    : [];

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <Link href="/reservar" className="inline-block py-1 text-sm underline">
        ← Reservar um horário avulso
      </Link>
      <h1 className="text-2xl font-semibold">Reservar um horário fixo</h1>
      <p className="text-sm text-zinc-700">Para quem atende no mesmo horário toda semana (ou a cada duas): você pede todas as datas de uma vez e os responsáveis aprovam a série inteira.</p>

      {busca.erro && TEXTO_ERRO_SERIE[busca.erro as ErroSerie] && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          {TEXTO_ERRO_SERIE[busca.erro as ErroSerie]}
        </p>
      )}

      {!sala ? (
        <p className="rounded-lg bg-amber-50 p-4 text-amber-900">A sala ainda não está configurada.</p>
      ) : !podePedir ? (
        <p className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">No momento não é possível fazer novas reservas com este cadastro.</p>
      ) : (
        <FormularioSerie
          turnos={turnos.map((t) => ({ id: t.id, nome: t.nome, inicio: horaInteira(t.inicio), fim: horaInteira(t.fim) }))}
          diasAbertos={sala.regras.diasFuncionamento}
          abre={horaInteira(sala.regras.abre)}
          fecha={horaInteira(sala.regras.fecha)}
          minData={formatarDataISO(somarDias(hoje, 1))}
          maxData={formatarDataISO(somarDias(hoje, sala.regras.antecedenciaMaxDias))}
          descontoPct={sala.regras.descontoPacoteMesPct}
          renovacaoDe={busca.renovacaoDe}
          valores={{
            dias: lista(busca.dias),
            freq: busca.freq ?? '',
            unidade: busca.unidade ?? '',
            turno: busca.turno ?? turnos[0]?.id ?? '',
            de: busca.de ?? '',
            ate: busca.ate ?? '',
            inicio: busca.inicio ?? '',
            fim: busca.fim ?? formatarDataISO(somarDias(hoje, 28)),
            pag: busca.pag ?? '',
          }}
        />
      )}
    </div>
  );
}
