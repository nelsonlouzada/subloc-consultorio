import 'dotenv/config';

/**
 * Banco dos testes. Fora do CI, os testes não usam o banco de desenvolvimento: usam um irmão dele,
 * com o sufixo `_teste` (ou o de `DATABASE_URL_TESTE`), criado e migrado sozinho. Assim os dados
 * de quem usa o app localmente nunca colidem com os dos testes (QA-10). No CI o banco já é descartável.
 */
export function urlDeTeste(): string {
  const explicita = process.env.DATABASE_URL_TESTE;
  if (explicita) return explicita;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('DATABASE_URL não definida: os testes precisam de um Postgres.');
  if (process.env.CI) return base;
  const url = new URL(base);
  if (!url.pathname.endsWith('_teste')) url.pathname = `${url.pathname}_teste`;
  return url.toString();
}
