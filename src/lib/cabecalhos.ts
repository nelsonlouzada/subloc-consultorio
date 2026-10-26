/**
 * Cabeçalhos de segurança de todas as respostas do sistema (usados em `next.config.ts`).
 *
 * - `X-Frame-Options: DENY`: nenhuma tela pode ser embutida em outro site (clickjacking nas telas do Anfitrião).
 * - `X-Content-Type-Options: nosniff`, `Referrer-Policy` e `Permissions-Policy`: o básico contra vazamento e abuso.
 * - `Strict-Transport-Security`: o navegador só fala HTTPS com o site depois da primeira visita.
 * - `Content-Security-Policy-Report-Only`: a política de conteúdo começa em modo de observação (o navegador mostra
 *   no console o que ela bloquearia, mas não bloqueia). Depois de um tempo sem violações, vira
 *   `Content-Security-Policy` (basta trocar o nome do cabeçalho abaixo, em `MODO_CSP`).
 */
export type CabecalhoHttp = { key: string; value: string };

/** 'Content-Security-Policy' bloqueia de verdade; a versão 'Report-Only' só registra as violações no console. */
export const MODO_CSP = 'Content-Security-Policy-Report-Only';

export function politicaDeConteudo(opcoes: { producao: boolean }): string {
  return [
    "default-src 'self'",
    // O Next injeta pequenos scripts embutidos na página; no desenvolvimento também precisa de eval.
    `script-src 'self' 'unsafe-inline'${opcoes.producao ? '' : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    // QR Code do Pix vem como imagem embutida (data:).
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // Sentry (monitoramento de erros no navegador).
    "connect-src 'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

export function cabecalhosDeSeguranca(opcoes: { producao: boolean }): CabecalhoHttp[] {
  return [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    { key: MODO_CSP, value: politicaDeConteudo(opcoes) },
  ];
}
