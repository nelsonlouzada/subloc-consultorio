import { Resend } from 'resend';

// Sem RESEND_API_KEY (desenvolvimento local), o e-mail é só escrito no console.
export async function enviarEmail(para: string, assunto: string, html: string) {
  const chave = process.env.RESEND_API_KEY;
  if (!chave) {
    console.log(`[e-mail local] para=${para} assunto="${assunto}"\n${html}`);
    return;
  }
  const { error } = await new Resend(chave).emails.send({
    from: process.env.EMAIL_REMETENTE ?? 'Sala <onboarding@resend.dev>',
    to: para,
    subject: assunto,
    html,
  });
  if (error) throw new Error(`Falha ao enviar e-mail: ${error.message}`);
}
