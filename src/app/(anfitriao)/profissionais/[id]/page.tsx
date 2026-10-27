import Link from 'next/link';
import { notFound } from 'next/navigation';
import { exigirAnfitriao } from '@/lib/sessao';
import { listarAuditoriaDe } from '@/modulos/auditoria/auditoria';
import { obterProfissional } from '@/modulos/identidade/aprovacao';
import { linkConsultaConselho } from '@/modulos/identidade/conselhos';
import { PROFISSOES, STATUS_PROFISSIONAL } from '@/modulos/identidade/opcoes';
import { formatarReais } from '@/lib/dinheiro';
import { descreverMomento, descreverPeriodo } from '@/modulos/agenda/calendario';
import { ROTULO_STATUS } from '@/modulos/agenda/consulta';
import { carteiraDoProfissional } from '@/modulos/carteira/carteira';
import { reservasDaFicha, ROTULO_MOVIMENTO, ROTULO_ORIGEM_CREDITO, type ReservaDaFicha } from '@/modulos/identidade/ficha';
import { aprovarAction, bloquearAction, concederCreditoAction, desativarAcessoAction, desbloquearAction, reativarAcessoAction, recusarAction } from '../actions';

export const metadata = { title: 'Profissional' };

const ACOES: Record<string, string> = {
  aprovar: 'Cadastro aprovado. O profissional foi avisado por e-mail.',
  recusar: 'Cadastro recusado. O profissional foi avisado por e-mail.',
  bloquear: 'Profissional bloqueado.',
  desbloquear: 'Profissional desbloqueado.',
  credito: 'Crédito concedido. O profissional foi avisado por e-mail.',
  acesso_desativado: 'Acesso desativado: o login foi fechado e as sessões abertas foram encerradas.',
  acesso_reativado: 'Acesso reativado: a pessoa pode entrar de novo.',
};
const ERROS_CREDITO: Record<string, string> = {
  credito_valor: 'Valor inválido. Use reais, por exemplo 50 ou 50,00 (até R$ 10.000).',
  credito_justificativa: 'Informe o motivo do crédito (ele fica no histórico).',
};

const NOME_ACAO: Record<string, string> = {
  cadastro_profissional: 'Cadastrou-se',
  profissional_aprovado: 'Aprovado',
  profissional_recusado: 'Recusado',
  profissional_bloqueado: 'Bloqueado',
  credito_manual: 'Crédito concedido',
  acesso_desativado: 'Acesso desativado',
  acesso_reativado: 'Acesso reativado',
};

const quando = (d: Date) =>
  d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });

// Mostra só o miolo do CPF: a conferência é pelo registro no conselho, e o resto é dado a mais.
const cpfMascarado = (cpf: string) => `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;

const botao = 'rounded-lg px-4 py-2.5 font-medium';

function ListaDeReservas({ itens, vazio }: { itens: ReservaDaFicha[]; vazio: string }) {
  if (itens.length === 0) return <p className="text-zinc-600">{vazio}</p>;
  return (
    <ul className="divide-y divide-zinc-200">
      {itens.map((r) => {
        const s = ROTULO_STATUS[r.status] ?? { nome: r.status, cor: 'bg-zinc-100 text-zinc-700' };
        return (
          <li key={r.id}>
            <Link href={`/reservas/${r.id}`} className="flex flex-wrap items-center gap-2 py-2 hover:underline">
              <span>{descreverPeriodo(r.inicio, r.fim)}</span>
              <span className="text-zinc-600">{formatarReais(r.valorCentavos)}</span>
              {r.serieId && <span className="text-xs text-zinc-600">série</span>}
              <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${s.cor}`}>{s.nome}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default async function DetalheProfissional({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aviso?: string; erro?: string }>;
}) {
  await exigirAnfitriao();
  const { id } = await params;
  const { aviso, erro } = await searchParams;
  const p = await obterProfissional(decodeURIComponent(id));
  if (!p) notFound();
  const historico = await listarAuditoriaDe('profissional', p.id);
  const consulta = linkConsultaConselho(p.conselho);
  const carteira = await carteiraDoProfissional(p.id);
  const saldo = carteira.saldoCentavos;
  const reservas = await reservasDaFicha(p.id);

  return (
    <div className="space-y-5">
      <Link href="/profissionais" className="inline-block py-1 text-sm underline">
        ← Voltar à lista
      </Link>
      <h1 className="text-3xl font-bold tracking-tight">{p.nome}</h1>

      {aviso && ACOES[aviso] && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
          {ACOES[aviso]}
        </p>
      )}
      {erro && ERROS_CREDITO[erro] && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          {ERROS_CREDITO[erro]}
        </p>
      )}
      {erro && !ERROS_CREDITO[erro] && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          O estado deste cadastro mudou enquanto você olhava. Confira abaixo e tente de novo.
        </p>
      )}

      <section className="space-y-2 card p-5 text-sm">
        <p>
          <span className="text-zinc-500">Estado:</span> <strong>{STATUS_PROFISSIONAL[p.status]}</strong>
          {p.motivoAvaliacao ? ` · ${p.motivoAvaliacao}` : ''}
        </p>
        <p>
          <span className="text-zinc-500">Profissão:</span> {PROFISSOES[p.profissao]}
        </p>
        <p>
          <span className="text-zinc-500">Registro:</span> {p.conselho} {p.registroNumero}/{p.registroUf}
          {consulta && (
            <>
              {' · '}
              <a href={consulta} target="_blank" rel="noopener noreferrer" className="underline">
                Conferir no site do conselho
              </a>
            </>
          )}
        </p>
        <p>
          <span className="text-zinc-500">E-mail:</span> {p.email}{' '}
          {p.emailVerificado ? '(confirmado)' : <strong className="text-amber-800">(ainda não confirmado)</strong>}
        </p>
        <p>
          <span className="text-zinc-500">Telefone:</span> {p.telefone ?? '—'}
        </p>
        <p>
          <span className="text-zinc-500">CPF:</span> {cpfMascarado(p.cpf)}
        </p>
        <p>
          <span className="text-zinc-500">Cadastro em:</span> {quando(p.criadoEm)}
        </p>
      </section>

      <section className="space-y-4 card p-5">
        <h2 className="font-semibold">Decisão</h2>

        {(p.status === 'pendente' || p.status === 'recusado') && (
          <form action={aprovarAction}>
            <input type="hidden" name="id" value={p.id} />
            <button type="submit" className={`${botao} btn-primary`}>
              {p.status === 'recusado' ? 'Reconsiderar e aprovar' : 'Aprovar cadastro'}
            </button>
          </form>
        )}

        {p.status === 'pendente' && (
          <form action={recusarAction} className="space-y-2">
            <input type="hidden" name="id" value={p.id} />
            <label htmlFor="motivo-recusa" className="block text-sm font-medium">
              Motivo da recusa <span className="font-normal text-zinc-500">(opcional, vai no e-mail)</span>
            </label>
            <input id="motivo-recusa" name="motivo" maxLength={300} className="w-full rounded-lg border border-zinc-300 px-3 py-2" />
            <button type="submit" className={`${botao} btn-destructive`}>
              Recusar cadastro
            </button>
            <p className="text-xs text-zinc-600">Recusar também recusa os pedidos de reserva em aberto e libera os horários.</p>
          </form>
        )}

        {p.status === 'aprovado' && (
          <form action={bloquearAction} className="space-y-2">
            <input type="hidden" name="id" value={p.id} />
            <label htmlFor="motivo-bloqueio" className="block text-sm font-medium">
              Motivo do bloqueio <span className="font-normal text-zinc-500">(opcional, só fica no histórico)</span>
            </label>
            <input id="motivo-bloqueio" name="motivo" maxLength={300} className="w-full rounded-lg border border-zinc-300 px-3 py-2" />
            <button type="submit" className={`${botao} btn-destructive`}>
              Bloquear profissional
            </button>
            <p className="text-xs text-zinc-600">Bloqueado não faz novas reservas. As reservas futuras ficam para você decidir.</p>
          </form>
        )}

        {p.status === 'bloqueado' && (
          <form action={desbloquearAction}>
            <input type="hidden" name="id" value={p.id} />
            <button type="submit" className={`${botao} btn-primary`}>
              Desbloquear
            </button>
          </form>
        )}
      </section>

      <section aria-label="Reservas" className="space-y-3 card p-5 text-sm">
        <h2 className="font-semibold">Reservas</h2>
        <p className="text-zinc-700">
          {reservas.contagens.realizadas} realizadas · {reservas.contagens.faltas} {reservas.contagens.faltas === 1 ? 'falta' : 'faltas'} · {reservas.contagens.canceladas} canceladas · {reservas.contagens.todas} no total
        </p>
        <h3 className="font-medium">Próximas</h3>
        <ListaDeReservas itens={reservas.proximas} vazio="Nenhuma reserva a caminho." />
        <h3 className="font-medium">Últimas</h3>
        <ListaDeReservas itens={reservas.recentes} vazio="Nenhuma reserva encerrada ainda." />
      </section>

      <section className="space-y-3 card p-5 text-sm">
        <h2 className="font-semibold">Acesso à conta</h2>
        {p.acessoAtivo ? (
          <form action={desativarAcessoAction} className="space-y-2">
            <input type="hidden" name="id" value={p.id} />
            <p className="text-zinc-700">A conta pode entrar no sistema. Desativar o acesso fecha o login e encerra as sessões abertas. As reservas futuras continuam: você decide o que fazer com elas.</p>
            <label htmlFor="motivo-acesso" className="block text-xs text-zinc-600">
              Motivo (só fica no histórico)
            </label>
            <input id="motivo-acesso" name="motivo" maxLength={300} autoComplete="off" className="w-full rounded-lg border border-zinc-300 px-3 py-2" />
            <button type="submit" className={`${botao} btn-destructive`}>
              Desativar o acesso
            </button>
          </form>
        ) : (
          <form action={reativarAcessoAction} className="space-y-2">
            <input type="hidden" name="id" value={p.id} />
            <p className="text-zinc-700">
              <strong>Acesso desativado.</strong> A pessoa não consegue entrar.
            </p>
            <button type="submit" className={`${botao} btn-primary`}>
              Reativar o acesso
            </button>
          </form>
        )}
      </section>

      <section className="space-y-3 card p-5 text-sm">
        <h2 className="font-semibold">Carteira</h2>
        <p>
          Saldo de crédito: <strong>{formatarReais(saldo)}</strong>
        </p>
        <form action={concederCreditoAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="id" value={p.id} />
          <div>
            <label htmlFor="valor-credito" className="block text-xs text-zinc-600">
              Valor (R$)
            </label>
            <input id="valor-credito" name="valor" required inputMode="decimal" autoComplete="off" placeholder="50,00" className="w-28 rounded-lg border border-zinc-300 px-3 py-2" />
          </div>
          <div className="min-w-48 flex-1">
            <label htmlFor="motivo-credito" className="block text-xs text-zinc-600">
              Motivo (vai no e-mail e no histórico)
            </label>
            <input id="motivo-credito" name="motivo" required maxLength={300} autoComplete="off" className="w-full rounded-lg border border-zinc-300 px-3 py-2" />
          </div>
          <button type="submit" className={`${botao} btn-primary`}>
            Conceder crédito
          </button>
        </form>
        <p className="text-xs text-zinc-600">O crédito é usado automaticamente nos próximos pedidos da pessoa e vence como os demais.</p>

        <h3 className="pt-2 font-medium">Lotes com saldo</h3>
        {carteira.lotes.length === 0 ? (
          <p className="text-zinc-600">Nenhum crédito válido.</p>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {carteira.lotes.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 py-2">
                <strong className="font-medium">{formatarReais(l.saldoCentavos)}</strong>
                <span className="text-zinc-600">de {formatarReais(l.valorInicialCentavos)} · {ROTULO_ORIGEM_CREDITO[l.origem] ?? l.origem}</span>
                <span className="ml-auto text-zinc-600">vence em {descreverMomento(l.validadeAte)}</span>
              </li>
            ))}
          </ul>
        )}

        <h3 className="pt-2 font-medium">Últimos movimentos</h3>
        {carteira.extrato.length === 0 ? (
          <p className="text-zinc-600">Sem movimentos.</p>
        ) : (
          <ul className="divide-y divide-zinc-200">
            {carteira.extrato.slice(0, 15).map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 py-2">
                <span className="text-zinc-600">{descreverMomento(m.criadoEm)}</span>
                <span>{ROTULO_MOVIMENTO[m.tipo] ?? m.tipo}</span>
                <strong className="ml-auto font-medium">{m.valorCentavos > 0 ? '+' : '−'}{formatarReais(Math.abs(m.valorCentavos))}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Histórico" className="card p-5">
        <h2 className="mb-2 font-semibold">Histórico</h2>
        {historico.length === 0 ? (
          <p className="text-sm text-zinc-600">Sem registros.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {historico.map((h, i) => (
              <li key={i}>
                {quando(h.quando)} · {NOME_ACAO[h.acao] ?? h.acao}
                {h.quem && h.acao !== 'cadastro_profissional' ? ` por ${h.quem}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
