import { Resend } from 'resend';
import { assuntoSeguro } from './assunto';

// Sem RESEND_API_KEY, em desenvolvimento, o e-mail é só escrito no console. Em produção a falta
// da chave é erro: do contrário o aviso ficaria registrado como "enviado" sem ter saído.
export async function enviarEmail(para: string, assuntoBruto: string, html: string) {
  const assunto = assuntoSeguro(assuntoBruto); // última defesa: nenhum assunto sai com marcação ou quebra de linha
  const chave = process.env.RESEND_API_KEY;
  if (!chave && process.env.NODE_ENV === 'production') {
    throw new Error('RESEND_API_KEY ausente: e-mail não enviado.');
  }
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
