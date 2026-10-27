import { eq } from 'drizzle-orm';
import { db, schema } from '@/db';
import { carregarTabelaPrecos } from './precos';
import { horaInteira } from './espaco';

/**
 * Dados da página pública da sala (T01). A agenda nunca aparece aqui (D1): só o que convence e
 * informa, sem dado de pessoa. Tudo sai do que o Anfitrião edita em Configurações.
 */

export type PaginaPublica = {
  nome: string;
  descricao: string | null;
  comodidades: string[];
  endereco: { linha1: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null } | null;
  funcionamento: { dias: number[]; abre: number; fecha: number };
  /** Nulo quando a tabela de preços ainda está incompleta: a página segue sem a seção de preços. */
  precos: { horaCentavos: number; diaCentavos: number; turnos: { nome: string; inicio: number; fim: number; centavos: number }[]; descontoPacoteMesPct: number } | null;
  regras: {
    duracaoMinHoras: number;
    antecedenciaMinHoras: number;
    antecedenciaMaxDias: number;
    cancelamentoIntegralHoras: number;
    cancelamentoParcialHoras: number;
    cancelamentoParcialPct: number;
  };
};

export async function carregarPaginaPublica(espacoId: string): Promise<PaginaPublica | null> {
  const [linha] = await db
    .select({ espaco: schema.espaco, regras: schema.regraEspaco })
    .from(schema.espaco)
    .innerJoin(schema.regraEspaco, eq(schema.regraEspaco.espacoId, schema.espaco.id))
    .where(eq(schema.espaco.id, espacoId));
  if (!linha || !linha.espaco.ativo) return null;
  const { espaco: e, regras: r } = linha;

  let precos: PaginaPublica['precos'] = null;
  try {
    const t = await carregarTabelaPrecos(espacoId);
    precos = { horaCentavos: t.horaCentavos, diaCentavos: t.diaCentavos, turnos: t.turnos.map(({ nome, inicio, fim, centavos }) => ({ nome, inicio, fim, centavos })), descontoPacoteMesPct: r.descontoPacoteMesPct };
  } catch {
    precos = null; // tabela incompleta: não derruba a página
  }

  const linha1 = [e.logradouro, e.numero].filter(Boolean).join(', ') + (e.complemento ? ` - ${e.complemento}` : '');
  const temEndereco = Boolean(linha1 || e.bairro || e.cidade || e.uf || e.cep);

  return {
    nome: e.nome,
    descricao: e.descricao,
    comodidades: e.comodidades,
    endereco: temEndereco ? { linha1: linha1 || null, bairro: e.bairro, cidade: e.cidade, uf: e.uf, cep: e.cep } : null,
    funcionamento: { dias: r.diasFuncionamento, abre: horaInteira(r.abre), fecha: horaInteira(r.fecha) },
    precos,
    regras: {
      duracaoMinHoras: r.duracaoMinHoras,
      antecedenciaMinHoras: r.antecedenciaMinHoras,
      antecedenciaMaxDias: r.antecedenciaMaxDias,
      cancelamentoIntegralHoras: r.cancelamentoIntegralHoras,
      cancelamentoParcialHoras: r.cancelamentoParcialHoras,
      cancelamentoParcialPct: r.cancelamentoParcialPct,
    },
  };
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

const DIAS = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];

/** [1,2,3,4,5,6] -> 'segunda a sábado'; [1,3,5] -> 'segunda, quarta e sexta'; [1,2,3,5] -> 'segunda a quarta e sexta'. */
export function descreverDias(dias: number[]): string {
  const ordenados = [...new Set(dias)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (ordenados.length === 0) return 'sem dias abertos';
  const grupos: number[][] = [];
  for (const d of ordenados) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && d === ultimo[ultimo.length - 1] + 1) ultimo.push(d);
    else grupos.push([d]);
  }
  const partes = grupos.map((g) => (g.length >= 3 ? `${DIAS[g[0]]} a ${DIAS[g[g.length - 1]]}` : g.map((d) => DIAS[d]).join(' e ')));
  return partes.length <= 1 ? (partes[0] ?? '') : `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
}

export const hora = (h: number) => `${String(h).padStart(2, '0')}h`;

/** Resumo de cancelamento em uma frase, a partir das regras que o Anfitrião configurou. */
export function descreverCancelamento(r: PaginaPublica['regras']): string {
  const integral = `${r.cancelamentoIntegralHoras} horas ou mais`;
  if (r.cancelamentoParcialPct === 0) return `Cancelando com ${integral} de antecedência, o valor volta em crédito; depois disso, não há devolução.`;
  return `Cancelando com ${integral} de antecedência, 100% do valor volta em crédito; com ${r.cancelamentoParcialHoras} horas ou mais, ${r.cancelamentoParcialPct}%; abaixo disso, não há devolução.`;
}

export function descricaoParaBusca(p: PaginaPublica): string {
  const base = p.descricao?.trim() || `Sala de consultório para alugar por hora, turno ou dia.`;
  const onde = p.endereco?.cidade ? ` Em ${p.endereco.cidade}${p.endereco.uf ? `/${p.endereco.uf}` : ''}.` : '';
  const cortado = base.length > 140 ? `${base.slice(0, 137).trimEnd()}...` : base;
  return `${cortado}${onde}`.slice(0, 200);
}

// ---------------------------------------------------------------------------
// SEO
// ---------------------------------------------------------------------------

/** Endereço público do site, sem barra no fim. Vem de variável de ambiente; sem ela, não há como montar links absolutos. */
export function urlDoSite(env: Record<string, string | undefined> = process.env): string | null {
  const valido = [env.SITE_URL, env.BETTER_AUTH_URL].map((v) => (v ?? '').trim()).find((v) => /^https?:\/\//.test(v));
  return valido ? valido.replace(/\/+$/, '') : null;
}

/** A página só pede para ser indexada quando `SITE_INDEXAVEL=true`; antes disso fica pública, mas fora do Google. */
export const siteIndexavel = (env: Record<string, string | undefined> = process.env) => env.SITE_INDEXAVEL === 'true';

const DIA_SCHEMA = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Dados estruturados (schema.org/LocalBusiness) para o Google mostrar endereço, horário e faixa de preço. */
export function dadosEstruturados(p: PaginaPublica, url: string | null): Record<string, unknown> {
  const dados: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: p.nome,
    description: descricaoParaBusca(p),
    openingHoursSpecification: [
      { '@type': 'OpeningHoursSpecification', dayOfWeek: [...p.funcionamento.dias].sort((a, b) => a - b).map((d) => DIA_SCHEMA[d]), opens: `${String(p.funcionamento.abre).padStart(2, '0')}:00`, closes: p.funcionamento.fecha === 24 ? '23:59' : `${String(p.funcionamento.fecha).padStart(2, '0')}:00` },
    ],
  };
  if (url) dados.url = url;
  if (p.endereco) {
    dados.address = {
      '@type': 'PostalAddress',
      ...(p.endereco.linha1 ? { streetAddress: p.endereco.linha1 } : {}),
      ...(p.endereco.cidade ? { addressLocality: p.endereco.cidade } : {}),
      ...(p.endereco.uf ? { addressRegion: p.endereco.uf } : {}),
      ...(p.endereco.cep ? { postalCode: p.endereco.cep } : {}),
      addressCountry: 'BR',
    };
  }
  if (p.comodidades.length) dados.amenityFeature = p.comodidades.map((nome) => ({ '@type': 'LocationFeatureSpecification', name: nome, value: true }));
  if (p.precos) {
    const valores = [p.precos.horaCentavos, p.precos.diaCentavos, ...p.precos.turnos.map((t) => t.centavos)];
    const reais = (c: number) => `R$${Math.round(c / 100)}`;
    dados.priceRange = `${reais(Math.min(...valores))}-${reais(Math.max(...valores))}`;
  }
  return dados;
}

/** JSON para dentro de <script type="application/ld+json">: "<" escapado, para o texto do Anfitrião não fechar a tag. */
export function jsonSeguro(dados: unknown): string {
  return JSON.stringify(dados).replace(/</g, '\\' + 'u003c');
}
