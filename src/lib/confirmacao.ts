/** Para onde a pessoa vai depois de clicar no link de confirmação do e-mail: o login, com um aviso de sucesso. */
export const DESTINO_APOS_CONFIRMAR = '/login?aviso=email_confirmado';

/**
 * Troca o destino do link de confirmação enviado pela biblioteca de login (que, sem isto, manda a pessoa
 * para a raiz do site, sem nenhuma mensagem) pelo destino acima, mantendo o token.
 */
export function urlDeConfirmacao(url: string): string {
  const u = new URL(url);
  u.searchParams.set('callbackURL', DESTINO_APOS_CONFIRMAR);
  return u.toString();
}
