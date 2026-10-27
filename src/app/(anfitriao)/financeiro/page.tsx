import Link from 'next/link';
import { formatarReais } from '@/lib/dinheiro';
import { exigirAnfitriao } from '@/lib/sessao';
import { descreverMomento } from '@/modulos/agenda/calendario';
import { carregarSala, horaInteira } from '@/modulos/configuracao/espaco';
import {
  descreverLancamento,
  extratoPorProfissional,
  formatarCpf,
  lancamentosDoMes,
  lerMes,
  mesAtual,
  mesVizinho,
  resumoDoMes,
  ROTULO_MEIO,
} from '@/modulos/financeiro/relatorio';

export const metadata = { title: 'Financeiro' };

const NOME_MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function Numero({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="card p-4">
      <p className="text-sm text-zinc-700">{rotulo}</p>
      <p className="text-2xl font-semibold tracking-tight">{valor}</p>
      {nota && <p className="mt-1 text-xs text-zinc-600">{nota}</p>}
    </div>
  );
}

export default async function Financeiro({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  await exigirAnfitriao();
  const { mes: pedido } = await searchParams;
  const mes = lerMes(pedido) ?? mesAtual();
  const sala = await carregarSala();

  const lancamentos = await lancamentosDoMes(mes);
  const resumo = await resumoDoMes(mes, lancamentos, {
    dias: sala?.regras.diasFuncionamento ?? [],
    abre: sala ? horaInteira(sala.regras.abre) : 0,
    fecha: sala ? horaInteira(sala.regras.fecha) : 0,
  });
  const extrato = extratoPorProfissional(lancamentos);
  const ocupacao = resumo.horasDeFuncionamento > 0 ? Math.round((resumo.horasReservadas / resumo.horasDeFuncionamento) * 100) : 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Financeiro</h1>
        <nav aria-label="Mês" className="ml-auto flex items-center gap-1">
          <Link href={`/financeiro?mes=${mesVizinho(mes, -1)}`} className="nav-link" aria-label="Mês anterior">
            ←
          </Link>
          <span className="min-w-36 text-center font-medium">
            {NOME_MES[mes.mes - 1].replace(/^./, (c) => c.toUpperCase())} de {mes.ano}
          </span>
          <Link href={`/financeiro?mes=${mesVizinho(mes, 1)}`} className="nav-link" aria-label="Mês seguinte">
            →
          </Link>
        </nav>
      </div>

      <section aria-label="Resumo do mês" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Numero rotulo="Recebido no mês" valor={formatarReais(resumo.recebidoCentavos)} nota={`${resumo.pagamentos} ${resumo.pagamentos === 1 ? 'pagamento' : 'pagamentos'}, pela data em que o dinheiro entrou`} />
        <Numero rotulo="Crédito usado" valor={formatarReais(resumo.creditoUsadoCentavos)} nota="Abateu pedidos, sem dinheiro novo" />
        <Numero rotulo="Crédito vencido" valor={formatarReais(resumo.creditoVencidoCentavos)} nota="Saldo que expirou sem uso" />
        <Numero rotulo="Créditos em aberto" valor={formatarReais(resumo.creditoEmAbertoCentavos)} nota="O que a sala deve em uso futuro (hoje)" />
        <Numero rotulo="Ocupação" valor={`${ocupacao}%`} nota={`${resumo.horasReservadas} h reservadas de ${resumo.horasDeFuncionamento} h de funcionamento`} />
        {resumo.estornadoCentavos > 0 && <Numero rotulo="Estornado" valor={formatarReais(resumo.estornadoCentavos)} nota="Fora do total recebido; confira com o contador" />}
      </section>

      <section aria-label="Exportação" className="card space-y-2 p-5 text-sm">
        <h2 className="text-lg font-semibold">Exportar para o carnê-leão</h2>
        <p className="text-zinc-700">
          Planilha com cada recebimento do mês: data, nome e CPF de quem pagou, descrição e valor, mais o total. Conta o dinheiro quando ele entra, mesmo que a sala seja usada em outro mês; pagamentos feitos só com crédito não entram. Confirme com o contador como tratar o crédito comprado e ainda não usado.
        </p>
        <a href={`/api/financeiro/carne-leao?mes=${mes.texto}`} className="btn btn-primary inline-block">
          Baixar {NOME_MES[mes.mes - 1]} de {mes.ano} (CSV)
        </a>
      </section>

      <section aria-label="Por profissional" className="space-y-3">
        <h2 className="text-lg font-semibold">Por profissional</h2>
        {extrato.length === 0 ? (
          <p className="text-sm text-zinc-600">Nenhum recebimento neste mês.</p>
        ) : (
          <div className="card divide-y divide-zinc-200 text-sm">
            {extrato.map((e) => (
              <p key={e.profissionalId} className="flex flex-wrap items-center gap-x-3 px-5 py-3">
                <Link href={`/profissionais/${encodeURIComponent(e.profissionalId)}`} className="inline-block py-1 font-medium underline">
                  {e.nome}
                </Link>
                <span className="text-zinc-600">
                  {e.pagamentos} {e.pagamentos === 1 ? 'pagamento' : 'pagamentos'}
                </span>
                <strong className="ml-auto font-semibold">{formatarReais(e.recebidoCentavos)}</strong>
              </p>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Lançamentos" className="space-y-3">
        <h2 className="text-lg font-semibold">Lançamentos</h2>
        {lancamentos.length === 0 ? (
          <p className="text-sm text-zinc-600">Nenhum recebimento neste mês.</p>
        ) : (
          <div className="card divide-y divide-zinc-200 text-sm">
            {lancamentos.map((l) => (
              <article key={l.cobrancaId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3">
                <span className="w-32 text-zinc-700">{descreverMomento(l.pagoEm)}</span>
                <span className="min-w-0 flex-1">
                  <strong className="font-medium">{l.pagador}</strong> <span className="text-zinc-600">· {formatarCpf(l.cpf)}</span>
                  <br />
                  <span className="text-zinc-700">
                    {descreverLancamento(l)} · {ROTULO_MEIO[l.meio ?? ''] ?? '—'}
                  </span>
                </span>
                <strong className="font-semibold">{formatarReais(l.valorCentavos)}</strong>
                <a href={`/api/recibos/${l.cobrancaId}`} target="_blank" rel="noopener noreferrer" className="inline-block py-1 underline">
                  Recibo
                </a>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
