import { exigirAnfitriao } from '@/lib/sessao';
import { carregarSala } from '@/modulos/configuracao/espaco';
import { regrasParaTela, TEXTO_ERRO_REGRAS } from '@/modulos/configuracao/regras';
import { salvarRegrasAction } from './actions';

export const metadata = { title: 'Configurações' };

const AVISOS: Record<string, string> = {
  salvo: 'Regras salvas. Valem para os próximos pedidos; reservas e cobranças já criadas não mudam.',
  sem_mudanca: 'Nada mudou.',
};
const DIAS = [
  [1, 'Segunda'],
  [2, 'Terça'],
  [3, 'Quarta'],
  [4, 'Quinta'],
  [5, 'Sexta'],
  [6, 'Sábado'],
  [7, 'Domingo'],
] as const;
const campo = 'w-28 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base';

function Numero({ nome, rotulo, valor, sufixo, ajuda }: { nome: string; rotulo: string; valor: number; sufixo: string; ajuda?: string }) {
  return (
    <div>
      <label htmlFor={nome} className="mb-1 block text-sm font-medium">
        {rotulo}
      </label>
      <div className="flex items-center gap-2">
        <input id={nome} name={nome} type="number" inputMode="numeric" min={0} required defaultValue={valor} className={campo} />
        <span className="text-sm text-zinc-700">{sufixo}</span>
      </div>
      {ajuda && <p className="mt-1 text-xs text-zinc-600">{ajuda}</p>}
    </div>
  );
}

export default async function Configuracoes({ searchParams }: { searchParams: Promise<{ aviso?: string; erro?: string }> }) {
  await exigirAnfitriao();
  const { aviso, erro } = await searchParams;
  const sala = await carregarSala();
  if (!sala) return <p className="rounded-lg bg-amber-50 p-4 text-amber-900">A sala ainda não foi cadastrada.</p>;
  const r = regrasParaTela(sala.regras);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
      <p className="text-sm text-zinc-700">Regras e prazos da sala. Cada mudança fica registrada com o seu nome.</p>

      {aviso && AVISOS[aviso] && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
          {AVISOS[aviso]}
        </p>
      )}
      {erro && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          {TEXTO_ERRO_REGRAS[erro] ?? TEXTO_ERRO_REGRAS.invalido}
        </p>
      )}

      <form action={salvarRegrasAction} className="space-y-6">
        <fieldset className="card space-y-4 p-5">
          <legend className="px-1 text-lg font-semibold">Funcionamento</legend>
          <div className="flex flex-wrap gap-2">
            {DIAS.map(([n, nome]) => (
              <label key={n} className="flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm">
                <input type="checkbox" name="diasFuncionamento" value={n} defaultChecked={r.diasFuncionamento.includes(n)} />
                {nome}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap gap-6">
            <Numero nome="abre" rotulo="Abre às" valor={r.abre} sufixo="h" />
            <Numero nome="fecha" rotulo="Fecha às" valor={r.fecha} sufixo="h" />
            <Numero nome="duracaoMinHoras" rotulo="Reserva mínima" valor={r.duracaoMinHoras} sufixo="hora(s)" />
          </div>
        </fieldset>

        <fieldset className="card space-y-4 p-5">
          <legend className="px-1 text-lg font-semibold">Antecedência</legend>
          <div className="flex flex-wrap gap-6">
            <Numero nome="antecedenciaMinHoras" rotulo="Mínima" valor={r.antecedenciaMinHoras} sufixo="horas antes" />
            <Numero nome="antecedenciaMaxDias" rotulo="Máxima" valor={r.antecedenciaMaxDias} sufixo="dias à frente" ajuda="É também o limite de uma série." />
            <Numero nome="travaMinutos" rotulo="Intervalo entre quem usa a sala" valor={r.travaMinutos} sufixo="minutos" ajuda="Vale para novas reservas." />
          </div>
        </fieldset>

        <fieldset className="card space-y-4 p-5">
          <legend className="px-1 text-lg font-semibold">Prazos</legend>
          <div className="flex flex-wrap gap-6">
            <Numero nome="prazoAprovacaoHoras" rotulo="Para aprovar um pedido" valor={r.prazoAprovacaoHoras} sufixo="horas" />
            <Numero nome="prazoPagamentoHoras" rotulo="Para pagar depois de aprovado" valor={r.prazoPagamentoHoras} sufixo="horas" />
            <Numero nome="corteAntesInicioHoras" rotulo="Fim dos prazos, antes do início" valor={r.corteAntesInicioHoras} sufixo="horas" ajuda="Os dois prazos acabam, no máximo, tantas horas antes do horário." />
          </div>
        </fieldset>

        <fieldset className="card space-y-4 p-5">
          <legend className="px-1 text-lg font-semibold">Cancelamento pelo profissional</legend>
          <p className="text-sm text-zinc-700">O que volta como crédito, conforme a antecedência. Abaixo do prazo parcial, nada volta.</p>
          <div className="flex flex-wrap gap-6">
            <Numero nome="cancelamentoIntegralHoras" rotulo="100% com" valor={r.cancelamentoIntegralHoras} sufixo="horas ou mais" />
            <Numero nome="cancelamentoParcialHoras" rotulo="Parcial com" valor={r.cancelamentoParcialHoras} sufixo="horas ou mais" />
            <Numero nome="cancelamentoParcialPct" rotulo="Percentual parcial" valor={r.cancelamentoParcialPct} sufixo="%" />
          </div>
        </fieldset>

        <fieldset className="card space-y-4 p-5">
          <legend className="px-1 text-lg font-semibold">Créditos, séries e avisos</legend>
          <div className="flex flex-wrap gap-6">
            <Numero nome="validadeCreditoDias" rotulo="Validade do crédito" valor={r.validadeCreditoDias} sufixo="dias" />
            <Numero nome="descontoPacoteMesPct" rotulo="Desconto do pacote do mês" valor={r.descontoPacoteMesPct} sufixo="%" />
            <Numero nome="avisoRenovacaoSerieDias" rotulo="Avisar para renovar a série" valor={r.avisoRenovacaoSerieDias} sufixo="dias antes do fim" />
            <Numero nome="horaLembreteVespera" rotulo="Lembrete da véspera às" valor={r.horaLembreteVespera} sufixo="h" />
          </div>
        </fieldset>

        <button type="submit" className="btn btn-primary">
          Salvar as regras
        </button>
      </form>
    </div>
  );
}
