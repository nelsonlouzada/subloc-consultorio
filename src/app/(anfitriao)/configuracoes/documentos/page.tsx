import Link from 'next/link';
import { exigirAnfitriao } from '@/lib/sessao';
import { descreverMomento } from '@/modulos/agenda/calendario';
import { listarVersoes, ROTULO_DOCUMENTO, TEXTO_ERRO_DOCUMENTO, type TipoDocumento } from '@/modulos/configuracao/documentos';
import { publicarDocumentoAction } from './actions';

export const metadata = { title: 'Contrato e termo' };

const TIPOS: TipoDocumento[] = ['contrato', 'termo_reserva'];

export default async function Documentos({ searchParams }: { searchParams: Promise<{ doc?: string; aviso?: string; erro?: string }> }) {
  await exigirAnfitriao();
  const busca = await searchParams;
  const tipo: TipoDocumento = busca.doc === 'termo_reserva' ? 'termo_reserva' : 'contrato';
  const versoes = await listarVersoes(tipo);
  const vigente = versoes[0];

  return (
    <div className="space-y-6">
      <p className="text-sm text-zinc-700">
        Uma versão publicada nunca é editada: cada aceite guarda a versão exata que a pessoa aceitou. Publicar uma versão nova vale para cadastros e pedidos feitos a partir de agora; quem já aceitou continua com a versão dela.
      </p>

      <nav aria-label="Documento" className="flex gap-1">
        {TIPOS.map((t) => (
          <Link key={t} href={`/configuracoes/documentos?doc=${t}`} aria-current={t === tipo ? 'page' : undefined} className="nav-link">
            {ROTULO_DOCUMENTO[t]}
          </Link>
        ))}
      </nav>

      {busca.aviso === 'publicado' && (
        <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-900">
          Nova versão publicada.
        </p>
      )}
      {busca.erro && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">
          {TEXTO_ERRO_DOCUMENTO[busca.erro] ?? 'Não foi possível publicar.'}
        </p>
      )}

      <form action={publicarDocumentoAction} className="card space-y-3 p-5">
        <input type="hidden" name="tipo" value={tipo} />
        <h2 className="text-lg font-semibold">
          {ROTULO_DOCUMENTO[tipo]}: publicar versão {vigente ? vigente.versao + 1 : 1}
        </h2>
        <p className="text-sm text-zinc-700">O texto abaixo é o da versão em vigor. Ajuste o que precisar e publique.</p>
        <label htmlFor="texto" className="sr-only">
          Texto do documento
        </label>
        <textarea id="texto" name="texto" required rows={18} defaultValue={vigente?.texto ?? ''} className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm" />
        <button type="submit" className="btn btn-primary">
          Publicar nova versão
        </button>
      </form>

      <section aria-label="Versões" className="card space-y-2 p-5">
        <h2 className="text-lg font-semibold">Versões publicadas</h2>
        <ul className="space-y-1 text-sm">
          {versoes.map((v, i) => (
            <li key={v.id}>
              <details>
                <summary className="cursor-pointer py-1">
                  Versão {v.versao}
                  {i === 0 ? ' (em vigor)' : ''} · {descreverMomento(v.publicadoEm)}
                  {v.publicadoPor ? ` · ${v.publicadoPor}` : ' · texto inicial'}
                </summary>
                <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-zinc-50 p-3 text-xs">{v.texto}</pre>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
