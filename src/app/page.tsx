import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { formatarReais } from '@/lib/dinheiro';
import { paginaInicial, sessaoAtual } from '@/lib/sessao';
import { carregarSala } from '@/modulos/configuracao/espaco';
import {
  carregarPaginaPublica,
  dadosEstruturados,
  descreverCancelamento,
  descreverDias,
  descricaoParaBusca,
  hora,
  jsonSeguro,
  siteIndexavel,
  urlDoSite,
  type PaginaPublica,
} from '@/modulos/configuracao/pagina-publica';

// Lê o banco a cada visita: o que o Anfitrião edita em Configurações aparece na hora.
export const dynamic = 'force-dynamic';

async function carregar(): Promise<PaginaPublica | null> {
  const sala = await carregarSala();
  return sala ? carregarPaginaPublica(sala.espaco.id) : null;
}

export async function generateMetadata(): Promise<Metadata> {
  const pagina = await carregar();
  const url = urlDoSite();
  const robots = siteIndexavel() ? { index: true, follow: true } : { index: false, follow: false };
  if (!pagina) return { title: { absolute: 'Sala de consultório' }, robots };

  const titulo = `${pagina.nome}: sala de consultório por hora, turno ou dia`;
  const descricao = descricaoParaBusca(pagina);
  return {
    title: { absolute: titulo },
    description: descricao,
    robots,
    ...(url ? { metadataBase: new URL(url), alternates: { canonical: '/' } } : {}),
    openGraph: { type: 'website', locale: 'pt_BR', title: titulo, description: descricao, siteName: pagina.nome, ...(url ? { url } : {}) },
    twitter: { card: 'summary', title: titulo, description: descricao },
  };
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-3 p-6">
      <h2 className="text-xl font-semibold tracking-tight">{titulo}</h2>
      {children}
    </section>
  );
}

export default async function PaginaDaSala() {
  const sessao = await sessaoAtual();
  if (sessao) redirect(paginaInicial(sessao.user.papel));

  const pagina = await carregar();
  if (!pagina) {
    return (
      <main className="mx-auto max-w-xl px-5 py-24 text-center">
        <h1 className="text-3xl font-bold tracking-tight">Sala de consultório</h1>
        <p className="mt-3 text-zinc-700">Em breve.</p>
        <Link href="/login" className="btn btn-primary mt-6 inline-block">
          Entrar
        </Link>
      </main>
    );
  }

  const { endereco, funcionamento: f, precos, regras } = pagina;
  const enderecoTexto = endereco ? [endereco.linha1, endereco.bairro, [endereco.cidade, endereco.uf].filter(Boolean).join('/'), endereco.cep].filter(Boolean).join(' · ') : null;
  const mapa = endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([endereco.linha1, endereco.bairro, endereco.cidade, endereco.uf, endereco.cep].filter(Boolean).join(', '))}` : null;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonSeguro(dadosEstruturados(pagina, urlDoSite())) }} />
      <header className="glass-bar">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-5 py-3">
          <span className="text-base font-semibold tracking-tight">{pagina.nome}</span>
          <Link href="/login" className="nav-link ml-auto">
            Entrar
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-5 py-10">
        <section className="space-y-4 py-6">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{pagina.nome}</h1>
          <p className="text-xl text-zinc-700">Sala de consultório para profissionais de saúde mental, por hora, turno ou dia.</p>
          {pagina.descricao && <p className="max-w-2xl whitespace-pre-line text-zinc-700">{pagina.descricao}</p>}
          <div className="flex flex-wrap gap-3 pt-2">
            <Link href="/cadastro" className="btn btn-primary">
              Quero reservar
            </Link>
            <Link href="/login" className="btn btn-tinted">
              Já tenho conta
            </Link>
          </div>
        </section>

        {pagina.comodidades.length > 0 && (
          <Secao titulo="O que está incluso">
            <ul className="grid gap-2 sm:grid-cols-2">
              {pagina.comodidades.map((c) => (
                <li key={c} className="flex items-center gap-2">
                  <span aria-hidden="true" className="text-[color:var(--link)]">
                    ✓
                  </span>
                  {c}
                </li>
              ))}
            </ul>
          </Secao>
        )}

        {precos && (
          <Secao titulo="Preços">
            <ul className="divide-y divide-zinc-200">
              <li className="flex items-baseline justify-between gap-4 py-2">
                <span>Hora</span>
                <strong className="font-semibold">{formatarReais(precos.horaCentavos)}</strong>
              </li>
              {precos.turnos.map((t) => (
                <li key={t.nome} className="flex items-baseline justify-between gap-4 py-2">
                  <span>
                    {t.nome} <span className="text-zinc-600">({hora(t.inicio)} às {hora(t.fim)})</span>
                  </span>
                  <strong className="font-semibold">{formatarReais(t.centavos)}</strong>
                </li>
              ))}
              <li className="flex items-baseline justify-between gap-4 py-2">
                <span>Dia inteiro</span>
                <strong className="font-semibold">{formatarReais(precos.diaCentavos)}</strong>
              </li>
            </ul>
            <p className="text-sm text-zinc-700">
              Você paga sempre o menor valor possível entre horas avulsas, turno e dia inteiro.
              {precos.descontoPacoteMesPct > 0 && ` Quem atende no mesmo horário toda semana pode reservar uma série e pagar o mês de uma vez, com ${precos.descontoPacoteMesPct}% de desconto.`}
            </p>
          </Secao>
        )}

        <Secao titulo="Funcionamento">
          <p>
            Abrimos de <strong>{descreverDias(f.dias)}</strong>, das {hora(f.abre)} às {hora(f.fecha)}.
          </p>
          <p className="text-sm text-zinc-700">
            Reserva mínima de {regras.duracaoMinHoras} {regras.duracaoMinHoras === 1 ? 'hora' : 'horas'}, feita com pelo menos {regras.antecedenciaMinHoras} horas de antecedência e até {regras.antecedenciaMaxDias} dias à frente. Os horários livres aparecem depois que você cria a sua conta.
          </p>
        </Secao>

        <Secao titulo="Como funciona">
          <ol className="list-decimal space-y-1 pl-5">
            <li>Crie a sua conta com o registro no conselho profissional. Os responsáveis aprovam o cadastro.</li>
            <li>Escolha o horário e envie o pedido. A resposta chega por e-mail.</li>
            <li>Depois de aprovado, pague por Pix para confirmar. Você recebe o código de acesso antes do horário.</li>
          </ol>
          <p className="text-sm text-zinc-700">{descreverCancelamento(regras)}</p>
        </Secao>

        {enderecoTexto && (
          <Secao titulo="Onde fica">
            <p>{enderecoTexto}</p>
            {mapa && (
              <a href={mapa} target="_blank" rel="noopener noreferrer" className="inline-block py-1 underline">
                Ver no mapa
              </a>
            )}
          </Secao>
        )}

        <section className="space-y-3 py-6 text-center">
          <h2 className="text-2xl font-semibold tracking-tight">Pronto para reservar?</h2>
          <Link href="/cadastro" className="btn btn-primary inline-block">
            Criar a minha conta
          </Link>
        </section>
      </main>

      <footer className="mx-auto max-w-4xl px-5 pb-10 text-sm text-zinc-600">
        <p>{pagina.nome}. Uso restrito a profissionais de saúde mental com registro ativo no conselho.</p>
      </footer>
    </>
  );
}
