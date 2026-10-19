import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from './auth';

export async function sessaoAtual() {
  return auth.api.getSession({ headers: await headers() });
}

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
