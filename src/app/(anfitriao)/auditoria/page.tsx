import Link from 'next/link';
import { exigirAnfitriao } from '@/lib/sessao';
import { descreverMomento } from '@/modulos/agenda/calendario';
import { linkDaEntidade, listarEventos, NOME_ENTIDADE, nomeDaAcao, opcoesDeFiltro, resumirDados } from '@/modulos/auditoria/lista';

export const metadata = { title: 'Auditoria' };

type Busca = { acao?: string; entidade?: string; pagina?: string };

const campo = 'rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base';

function endereco(filtro: { acao?: string; entidade?: string }, pagina: number) {
  const q = new URLSearchParams();
  if (filtro.acao) q.set('acao', filtro.acao);
  if (filtro.entidade) q.set('entidade', filtro.entidade);
  if (pagina > 1) q.set('pagina', String(pagina));
  const texto = q.toString();
  return texto ? `/auditoria?${texto}` : '/auditoria';
}

export default async function Auditoria({ searchParams }: { searchParams: Promise<Busca> }) {
  await exigirAnfitriao();
  const busca = await searchParams;
  const opcoes = await opcoesDeFiltro();
  // Filtro que não existe entre as opções é ignorado, em vez de listar vazio por engano.
  const acao = opcoes.acoes.includes(busca.acao ?? '') ? busca.acao : undefined;
  const entidade = opcoes.entidades.includes(busca.entidade ?? '') ? busca.entidade : undefined;
  const { linhas, total, pagina, paginas } = await listarEventos({ acao, entidade, pagina: Number(busca.pagina) });

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Auditoria</h1>
      <p className="text-sm text-zinc-700">Quem fez o quê no sistema, do mais novo para o mais antigo. Só leitura: nada aqui pode ser editado.</p>

      <form method="get" action="/auditoria" className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label htmlFor="acao" className="mb-1 block text-sm font-medium">
            Ação
          </label>
          <select id="acao" name="acao" defaultValue={acao ?? ''} className={campo}>
            <option value="">Todas</option>
            {opcoes.acoes.map((a) => (
              <option key={a} value={a}>
                {nomeDaAcao(a)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="entidade" className="mb-1 block text-sm font-medium">
            Sobre
          </label>
          <select id="entidade" name="entidade" defaultValue={entidade ?? ''} className={campo}>
            <option value="">Tudo</option>
            {opcoes.entidades.map((e) => (
              <option key={e} value={e}>
                {NOME_ENTIDADE[e] ?? e}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary">
          Filtrar
        </button>
        {(acao || entidade) && (
          <Link href="/auditoria" className="inline-block py-2 text-sm underline">
            Limpar filtros
          </Link>
        )}
      </form>

      <p className="text-sm text-zinc-700" role="status">
        {total === 0 ? 'Nenhum registro.' : `${total} ${total === 1 ? 'registro' : 'registros'}, página ${pagina} de ${paginas}.`}
      </p>

      {linhas.length > 0 && (
        <div className="card divide-y divide-zinc-200 text-sm">
          {linhas.map((l) => {
            const destino = linkDaEntidade(l.entidade, l.entidadeId);
            const resumo = resumirDados(l.dados);
            return (
              <article key={l.id} className="space-y-1 px-5 py-3">
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <strong className="font-medium">{nomeDaAcao(l.acao)}</strong>
                  <span className="text-zinc-700">{l.quem ? `por ${l.quem}` : 'automático'}</span>
                  <span className="ml-auto text-zinc-600">{descreverMomento(l.quando)}</span>
                </p>
                <p className="flex flex-wrap items-center gap-x-3 text-zinc-600">
                  <span>{NOME_ENTIDADE[l.entidade] ?? l.entidade}</span>
                  {destino && (
                    <Link href={destino} className="inline-block py-1 underline">
                      Abrir
                    </Link>
                  )}
                  {l.ip && <span>IP {l.ip}</span>}
                </p>
                {resumo && <p className="break-words font-mono text-xs text-zinc-700">{resumo}</p>}
              </article>
            );
          })}
        </div>
      )}

      {paginas > 1 && (
        <nav aria-label="Páginas" className="flex items-center gap-3 text-sm">
          {pagina > 1 ? (
            <Link href={endereco({ acao, entidade }, pagina - 1)} className="btn btn-tinted btn-sm">
              ← Mais novos
            </Link>
          ) : (
            <span />
          )}
          {pagina < paginas && (
            <Link href={endereco({ acao, entidade }, pagina + 1)} className="btn btn-tinted btn-sm ml-auto">
              Mais antigos →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
