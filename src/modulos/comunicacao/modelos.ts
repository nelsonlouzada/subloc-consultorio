// Modelos de e-mail. Todo texto vindo de usuário passa por esc() antes de entrar no HTML.

export function esc(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Endereço público do sistema, para os links dos e-mails. */
export const urlBase = () => (process.env.BETTER_AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');

function layout(titulo: string, corpo: string): string {
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#18181b">
<h2 style="font-size:18px">${esc(titulo)}</h2>
${corpo}
<p style="color:#71717a;font-size:12px;margin-top:24px">Mensagem automática do painel da sala.</p>
</div>`;
}

const botao = (href: string, texto: string) =>
  `<p><a href="${esc(href)}" style="display:inline-block;background:#18181b;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${esc(texto)}</a></p>`;

export function emailNovoCadastro(p: { nome: string; profissao: string; conselho: string; registro: string; uf: string }) {
  return {
    assunto: `Novo cadastro para aprovar: ${p.nome}`,
    html: layout(
      'Novo cadastro de profissional',
      `<p><strong>${esc(p.nome)}</strong> se cadastrou e aguarda a sua aprovação.</p>
<p>${esc(p.profissao)} · ${esc(p.conselho)} ${esc(p.registro)}/${esc(p.uf)}</p>
${botao(`${urlBase()}/profissionais`, 'Ver cadastros')}`,
    ),
  };
}

export function emailCadastroAprovado(nome: string) {
  return {
    assunto: 'Seu cadastro foi aprovado',
    html: layout(
      'Cadastro aprovado',
      `<p>Olá, ${esc(nome)}. Seu cadastro foi aprovado. Você já pode reservar a sala.</p>
${botao(`${urlBase()}/reservar`, 'Reservar a sala')}`,
    ),
  };
}

export function emailCadastroRecusado(nome: string, motivo: string | null) {
  return {
    assunto: 'Sobre o seu cadastro',
    html: layout(
      'Cadastro não aprovado',
      `<p>Olá, ${esc(nome)}. Não foi possível aprovar o seu cadastro neste momento.</p>
${motivo ? `<p>Motivo informado: ${esc(motivo)}</p>` : ''}
<p>Se achar que houve engano, responda a este e-mail.</p>`,
    ),
  };
}
