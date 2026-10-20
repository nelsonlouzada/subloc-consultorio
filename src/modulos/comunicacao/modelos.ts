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

export function emailNovaSolicitacao(p: { nome: string; periodo: string; valor: string }) {
  return {
    assunto: `Nova solicitação de reserva: ${p.nome}`,
    html: layout(
      'Nova solicitação de reserva',
      `<p><strong>${esc(p.nome)}</strong> pediu a sala.</p>
<p>${esc(p.periodo)} · ${esc(p.valor)}</p>
<p>O horário já está retido. Aprove ou recuse dentro do prazo.</p>
${botao(`${urlBase()}/solicitacoes`, 'Ver solicitações')}`,
    ),
  };
}

export function emailReservaAprovada(p: {
  nome: string;
  periodo: string;
  valor: string;
  prazoPagamento: string;
  pix: { chave: string; beneficiario: string } | null;
}) {
  const pagamento = p.pix
    ? `<p><strong>Pague por Pix até ${esc(p.prazoPagamento)}:</strong></p>
<p>Valor: <strong>${esc(p.valor)}</strong><br>Chave Pix: <strong>${esc(p.pix.chave)}</strong><br>Favorecido: ${esc(p.pix.beneficiario)}</p>
<p>Depois do pagamento, os responsáveis confirmam o recebimento e a reserva fica confirmada. Sem pagamento até esse horário, o horário é liberado.</p>`
    : `<p>Valor: <strong>${esc(p.valor)}</strong>. Os responsáveis vão enviar os dados do pagamento. O prazo para pagar vai até ${esc(p.prazoPagamento)}; depois dele o horário é liberado.</p>`;
  return {
    assunto: 'Sua reserva foi aprovada: falta o pagamento',
    html: layout(
      'Reserva aprovada',
      `<p>Olá, ${esc(p.nome)}. Seu pedido para <strong>${esc(p.periodo)}</strong> foi aprovado.</p>
${pagamento}
${botao(`${urlBase()}/reservar`, 'Ver meus pedidos')}`,
    ),
  };
}

export function emailReservaRecusada(p: { nome: string; periodo: string; motivo: string | null }) {
  return {
    assunto: 'Seu pedido de reserva não foi aprovado',
    html: layout(
      'Pedido não aprovado',
      `<p>Olá, ${esc(p.nome)}. Não foi possível aprovar o seu pedido para <strong>${esc(p.periodo)}</strong>. O horário foi liberado.</p>
${p.motivo ? `<p>Motivo informado: ${esc(p.motivo)}</p>` : ''}
${botao(`${urlBase()}/reservar`, 'Escolher outro horário')}`,
    ),
  };
}

export function emailReservaExpirada(p: { nome: string; periodo: string; etapa: 'aprovacao' | 'pagamento' }) {
  return {
    assunto: 'Seu pedido de reserva expirou',
    html: layout(
      'Pedido expirado',
      `<p>Olá, ${esc(p.nome)}. O pedido para <strong>${esc(p.periodo)}</strong> expirou ${
        p.etapa === 'aprovacao' ? 'sem resposta dentro do prazo' : 'porque o pagamento não foi confirmado dentro do prazo'
      }, e o horário foi liberado.</p>
${botao(`${urlBase()}/reservar`, 'Fazer um novo pedido')}`,
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
