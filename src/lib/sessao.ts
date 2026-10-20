import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { db, schema } from '@/db';
import { auth } from './auth';

export async function sessaoAtual() {
  return auth.api.getSession({ headers: await headers() });
}

/** Para onde cada papel vai depois de entrar. */
export const paginaInicial = (papel: string) => (papel === 'anfitriao' ? '/inicio' : '/reservar');

/**
 * Barreira de acesso da área do Anfitrião. Chamar no início de TODA página e TODA ação do
 * servidor dessa área: a autorização não pode depender de a tela esconder um botão.
 */
export async function exigirAnfitriao() {
  const sessao = await sessaoAtual();
  if (!sessao) redirect('/login');
  if (sessao.user.papel !== 'anfitriao') redirect('/login?erro=acesso');
  return sessao;
}

/** Barreira da área do Profissional. Devolve também o cadastro profissional (com o estado atual). */
export async function exigirProfissional() {
  const sessao = await sessaoAtual();
  if (!sessao) redirect('/login');
  if (sessao.user.papel !== 'profissional') redirect('/login?erro=acesso');
  const [profissional] = await db
    .select()
    .from(schema.profissional)
    .where(eq(schema.profissional.usuarioId, sessao.user.id));
  if (!profissional) redirect('/login?erro=acesso');
  return { sessao, profissional };
}

/** IP e navegador da requisição, para o registro de aceites e da auditoria. */
export async function contextoRequisicao() {
  const h = await headers();
  return {
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null,
    userAgent: h.get('user-agent'),
  };
}
