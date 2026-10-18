import { NextResponse } from 'next/server';

// TEMPORÁRIO (E0): mostra quais variáveis chegaram ao container, sem revelar valores.
// Remover assim que o deploy estiver estável.
export const dynamic = 'force-dynamic';

export function GET() {
  const nomes = [
    'DATABASE_URL',
    'BETTER_AUTH_SECRET',
    'BETTER_AUTH_URL',
    'RESEND_API_KEY',
    'EMAIL_REMETENTE',
    'SENTRY_DSN_WEB',
    'NEXT_PUBLIC_SENTRY_DSN',
    'NODE_ENV',
  ];
  const variaveis = Object.fromEntries(
    nomes.map((n) => [n, process.env[n] === undefined ? 'AUSENTE' : `ok (${process.env[n]!.length} caracteres)`]),
  );
  // Nomes parecidos com os esperados ajudam a achar erro de digitação.
  const parecidas = Object.keys(process.env).filter((k) => /auth|secret|better/i.test(k));
  return NextResponse.json({ variaveis, parecidas });
}
