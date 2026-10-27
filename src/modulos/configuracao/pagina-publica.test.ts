import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool, schema } from '@/db';
import { fabrica } from '@/test/fabrica';
import {
  carregarPaginaPublica,
  dadosEstruturados,
  descreverCancelamento,
  descreverDias,
  descricaoParaBusca,
  jsonSeguro,
  siteIndexavel,
  urlDoSite,
  type PaginaPublica,
} from './pagina-publica';

const f = fabrica();
afterAll(async () => {
  await f.limpar();
  await pool.end();
});

const pagina = (ajuste: Partial<PaginaPublica> = {}): PaginaPublica => ({
  nome: 'Sala Centro',
  descricao: 'Sala silenciosa.',
  comodidades: ['Wi-Fi', 'Ar-condicionado'],
  endereco: { linha1: 'Rua das Flores, 100', bairro: 'Centro', cidade: 'Campinas', uf: 'SP', cep: '13010-000' },
  funcionamento: { dias: [1, 2, 3, 4, 5, 6], abre: 7, fecha: 22 },
  precos: { horaCentavos: 5000, diaCentavos: 45000, turnos: [{ nome: 'Manhã', inicio: 7, fim: 12, centavos: 20000 }], descontoPacoteMesPct: 10 },
  regras: { duracaoMinHoras: 1, antecedenciaMinHoras: 24, antecedenciaMaxDias: 60, cancelamentoIntegralHoras: 48, cancelamentoParcialHoras: 24, cancelamentoParcialPct: 50 },
  ...ajuste,
});

describe('descrever os dias', () => {
  it.each([
    [[1, 2, 3, 4, 5, 6], 'segunda a sábado'],
    [[1, 2, 3, 4, 5], 'segunda a sexta'],
    [[1, 3, 5], 'segunda, quarta e sexta'],
    [[1, 2, 3, 5], 'segunda a quarta e sexta'],
    [[1, 2], 'segunda e terça'],
    [[7], 'domingo'],
    [[6, 7], 'sábado e domingo'],
    [[5, 1, 5, 2, 3], 'segunda a quarta e sexta'],
    [[1, 2, 3, 4, 5, 6, 7], 'segunda a domingo'],
    [[], 'sem dias abertos'],
  ])('%j -> %s', (dias, texto) => {
    expect(descreverDias(dias)).toBe(texto);
  });
});

describe('texto e SEO', () => {
  it('resume o cancelamento com os valores configurados, e sem parcial quando é 0%', () => {
    expect(descreverCancelamento(pagina().regras)).toBe(
      'Cancelando com 48 horas ou mais de antecedência, 100% do valor volta em crédito; com 24 horas ou mais, 50%; abaixo disso, não há devolução.',
    );
    expect(descreverCancelamento({ ...pagina().regras, cancelamentoParcialPct: 0 })).toBe(
      'Cancelando com 48 horas ou mais de antecedência, o valor volta em crédito; depois disso, não há devolução.',
    );
  });

  it('descrição para busca: usa a da sala, corta em 140 e acrescenta a cidade; tem um texto padrão', () => {
    expect(descricaoParaBusca(pagina())).toBe('Sala silenciosa. Em Campinas/SP.');
    expect(descricaoParaBusca(pagina({ descricao: null, endereco: null }))).toBe('Sala de consultório para alugar por hora, turno ou dia.');
    const longa = descricaoParaBusca(pagina({ descricao: 'x'.repeat(500) }));
    expect(longa.length).toBeLessThanOrEqual(200);
    expect(longa).toContain('...');
  });

  it('dados estruturados: horário, endereço, comodidades e faixa de preço', () => {
    const d = dadosEstruturados(pagina(), 'https://sala.example.com');
    expect(d).toMatchObject({
      '@type': 'LocalBusiness',
      name: 'Sala Centro',
      url: 'https://sala.example.com',
      priceRange: 'R$50-R$450',
      address: { streetAddress: 'Rua das Flores, 100', addressLocality: 'Campinas', addressRegion: 'SP', postalCode: '13010-000', addressCountry: 'BR' },
      openingHoursSpecification: [{ opens: '07:00', closes: '22:00', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] }],
    });
    expect((d.amenityFeature as unknown[]).length).toBe(2);
  });

  it('dados estruturados sem endereço, preço, comodidade ou URL: omite o que não há, em vez de inventar', () => {
    const d = dadosEstruturados(pagina({ endereco: null, precos: null, comodidades: [] }), null);
    expect(d).not.toHaveProperty('address');
    expect(d).not.toHaveProperty('priceRange');
    expect(d).not.toHaveProperty('amenityFeature');
    expect(d).not.toHaveProperty('url');
  });

  it('fecha à meia-noite vira 23:59 (o formato não aceita 24:00)', () => {
    const d = dadosEstruturados(pagina({ funcionamento: { dias: [1], abre: 8, fecha: 24 } }), null);
    expect((d.openingHoursSpecification as { closes: string }[])[0].closes).toBe('23:59');
  });

  it('o JSON da página não deixa o texto do Anfitrião fechar a tag <script>', () => {
    const texto = jsonSeguro(dadosEstruturados(pagina({ nome: '</script><script>alert(1)</script>' }), null));
    expect(texto).not.toContain('<');
    expect(JSON.parse(texto).name).toBe('</script><script>alert(1)</script>');
  });

  it('endereço do site vem do ambiente e só aceita http(s); indexação só com SITE_INDEXAVEL=true', () => {
    expect(urlDoSite({ SITE_URL: 'https://sala.example.com/' })).toBe('https://sala.example.com');
    expect(urlDoSite({ BETTER_AUTH_URL: 'http://localhost:3000' })).toBe('http://localhost:3000');
    expect(urlDoSite({ SITE_URL: 'javascript:alert(1)', BETTER_AUTH_URL: 'https://b.example.com' })).toBe('https://b.example.com');
    expect(urlDoSite({})).toBeNull();
    expect(siteIndexavel({ SITE_INDEXAVEL: 'true' })).toBe(true);
    expect(siteIndexavel({ SITE_INDEXAVEL: '1' })).toBe(false);
    expect(siteIndexavel({})).toBe(false);
  });
});

describe('carregar a página', () => {
  it('monta tudo a partir da sala: endereço, funcionamento, preços vigentes e regras', async () => {
    const { espacoId } = await f.sala({ cancelamentoIntegralHoras: 72, cancelamentoParcialPct: 30 });
    await db.update(schema.espaco).set({ nome: 'Sala X', cidade: 'Campinas', uf: 'SP', logradouro: 'Rua A', numero: '10', complemento: 'sala 2', comodidades: ['Wi-Fi'] }).where(eq(schema.espaco.id, espacoId));

    const p = (await carregarPaginaPublica(espacoId))!;
    expect(p).toMatchObject({
      nome: 'Sala X',
      comodidades: ['Wi-Fi'],
      endereco: { linha1: 'Rua A, 10 - sala 2', cidade: 'Campinas', uf: 'SP' },
      funcionamento: { dias: [1, 2, 3, 4, 5, 6], abre: 7, fecha: 22 },
      regras: { cancelamentoIntegralHoras: 72, cancelamentoParcialPct: 30, antecedenciaMaxDias: 60 },
    });
    expect(p.precos).toMatchObject({ horaCentavos: 5000, diaCentavos: 45000, descontoPacoteMesPct: 10 });
    expect(p.precos!.turnos.map((t) => [t.nome, t.inicio, t.fim, t.centavos])).toEqual([['Turno 1', 7, 12, 20000], ['Turno 2', 13, 22, 30000]]);
  });

  it('sem endereço preenchido, não há endereço; nada de dados de pessoas ou de agenda no resultado', async () => {
    const { espacoId } = await f.sala();
    const p = (await carregarPaginaPublica(espacoId))!;
    expect(p.endereco).toBeNull();
    expect(Object.keys(p).sort()).toEqual(['comodidades', 'descricao', 'endereco', 'funcionamento', 'nome', 'precos', 'regras']);
  });

  it('tabela de preços incompleta não derruba a página: só some a seção de preços', async () => {
    const { espacoId } = await f.sala();
    await db.delete(schema.preco).where(eq(schema.preco.espacoId, espacoId));
    const p = (await carregarPaginaPublica(espacoId))!;
    expect(p.precos).toBeNull();
    expect(p.nome).toBe('Sala de teste');
  });

  it('sala inativa ou inexistente não tem página', async () => {
    const { espacoId } = await f.sala();
    await db.update(schema.espaco).set({ ativo: false }).where(eq(schema.espaco.id, espacoId));
    expect(await carregarPaginaPublica(espacoId)).toBeNull();
    expect(await carregarPaginaPublica('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});
