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
  /** Valor que falta pagar por Pix, já descontado o crédito usado. */
  valor: string;
  creditoUsado?: string | null;
  prazoPagamento: string;
  pix: { chave: string; beneficiario: string } | null;
  /** Pix do Asaas, quando o pagamento online está ligado: confirma sozinho, sem ninguém conferir. */
  online?: { copiaCola: string; faturaUrl: string | null } | null;
  reservaId: string;
}) {
  const pagamento = p.online
    ? `<p><strong>Pague por Pix até ${esc(p.prazoPagamento)}:</strong></p>
<p>Valor: <strong>${esc(p.valor)}</strong></p>
<p>Pix copia e cola:<br><span style="word-break:break-all;font-family:monospace;font-size:12px">${esc(p.online.copiaCola)}</span></p>
<p>O QR Code e o pagamento por cartão estão na página da reserva. Assim que o pagamento for reconhecido, a reserva é confirmada automaticamente. Sem pagamento até esse horário, o horário é liberado.</p>`
    : p.pix
    ? `<p><strong>Pague por Pix até ${esc(p.prazoPagamento)}:</strong></p>
<p>Valor: <strong>${esc(p.valor)}</strong><br>Chave Pix: <strong>${esc(p.pix.chave)}</strong><br>Favorecido: ${esc(p.pix.beneficiario)}</p>
<p>Depois do pagamento, os responsáveis confirmam o recebimento e a reserva fica confirmada. Sem pagamento até esse horário, o horário é liberado.</p>`
    : `<p>Valor: <strong>${esc(p.valor)}</strong>. Os responsáveis vão enviar os dados do pagamento. O prazo para pagar vai até ${esc(p.prazoPagamento)}; depois dele o horário é liberado.</p>`;
  return {
    assunto: 'Sua reserva foi aprovada: falta o pagamento',
    html: layout(
      'Reserva aprovada',
      `<p>Olá, ${esc(p.nome)}. Seu pedido para <strong>${esc(p.periodo)}</strong> foi aprovado.</p>
${p.creditoUsado ? `<p>Usamos <strong>${esc(p.creditoUsado)}</strong> do seu crédito neste pedido.</p>` : ''}
${pagamento}
${botao(`${urlBase()}/minhas-reservas/${encodeURIComponent(p.reservaId)}`, 'Ver a reserva')}`,
    ),
  };
}

export function emailPagamentoConfirmado(p: { nome: string; periodo: string; valor: string; reservaId: string; credito?: boolean }) {
  return {
    assunto: p.credito ? 'Reserva aprovada e confirmada com seu crédito' : 'Pagamento recebido: sua reserva está confirmada',
    html: layout(
      'Reserva confirmada',
      `<p>Olá, ${esc(p.nome)}. ${
        p.credito
          ? `Seu pedido foi aprovado e pago com <strong>${esc(p.valor)}</strong> do seu crédito`
          : `Recebemos o pagamento de <strong>${esc(p.valor)}</strong>`
      } e a sua reserva para <strong>${esc(p.periodo)}</strong> está confirmada.</p>
<p>O código de acesso à sala será enviado por e-mail antes do horário.</p>
${botao(`${urlBase()}/minhas-reservas/${encodeURIComponent(p.reservaId)}`, 'Ver a reserva')}`,
    ),
  };
}

export function emailCodigoAcesso(p: { nome: string; periodo: string; codigo: string; reservaId: string }) {
  return {
    assunto: 'Código de acesso à sala',
    html: layout(
      'Código de acesso',
      `<p>Olá, ${esc(p.nome)}. Sua reserva é <strong>${esc(p.periodo)}</strong>.</p>
<p>Código de acesso: <strong style="font-size:20px;letter-spacing:2px">${esc(p.codigo)}</strong></p>
<p>O código é pessoal, vale só para este horário e não deve ser repassado. Deixe a sala limpa e organizada e respeite o horário de saída.</p>
${botao(`${urlBase()}/minhas-reservas/${encodeURIComponent(p.reservaId)}`, 'Ver a reserva')}`,
    ),
  };
}

export function emailLembreteVespera(p: { nome: string; periodo: string; codigo: string | null; reservaId: string }) {
  return {
    assunto: 'Lembrete: você tem a sala amanhã',
    html: layout(
      'Lembrete da sua reserva',
      `<p>Olá, ${esc(p.nome)}. Amanhã você tem a sala: <strong>${esc(p.periodo)}</strong>.</p>
<p>${p.codigo ? `Código de acesso: <strong>${esc(p.codigo)}</strong>.` : 'O código de acesso será enviado pelos responsáveis antes do horário.'}</p>
${botao(`${urlBase()}/minhas-reservas/${encodeURIComponent(p.reservaId)}`, 'Ver a reserva')}`,
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

export function emailReservaCancelada(p: { nome: string; periodo: string; motivo: string | null; credito: string | null }) {
  return {
    assunto: 'Sua reserva foi cancelada',
    html: layout(
      'Reserva cancelada',
      `<p>Olá, ${esc(p.nome)}. Os responsáveis pela sala cancelaram a sua reserva de <strong>${esc(p.periodo)}</strong>. O horário foi liberado e o código de acesso, se havia, deixou de valer.</p>
${p.motivo ? `<p>Motivo informado: ${esc(p.motivo)}</p>` : ''}
${p.credito ? `<p>Como o pagamento já tinha sido recebido, o valor de <strong>${esc(p.credito)}</strong> virou crédito na sua carteira e pode ser usado numa nova reserva.</p>` : ''}
${botao(`${urlBase()}/reservar`, 'Escolher outro horário')}`,
    ),
  };
}

export function emailPagamentoAtrasadoVirouCredito(p: { nome: string; periodo: string; valor: string }) {
  return {
    assunto: 'Recebemos seu pagamento: o valor virou crédito',
    html: layout(
      'Pagamento recebido como crédito',
      `<p>Olá, ${esc(p.nome)}. Recebemos o seu pagamento de <strong>${esc(p.valor)}</strong> para <strong>${esc(p.periodo)}</strong>, mas a reserva já não estava disponível para recebê-lo (o prazo passou e o horário foi ocupado, ou ela foi cancelada).</p>
<p>O valor total está na sua carteira como crédito e pode ser usado numa nova reserva.</p>
${botao(`${urlBase()}/reservar`, 'Escolher outro horário')}`,
    ),
  };
}

export function emailCreditoComprado(p: { nome: string; pacote: string; pago: string; credito: string }) {
  return {
    assunto: 'Crédito comprado: já está na sua carteira',
    html: layout(
      'Crédito na carteira',
      `<p>Olá, ${esc(p.nome)}. Recebemos o pagamento de <strong>${esc(p.pago)}</strong> do pacote <strong>${esc(p.pacote)}</strong>.</p>
<p><strong>${esc(p.credito)}</strong> já estão na sua carteira e são usados automaticamente nos próximos pedidos.</p>
${botao(`${urlBase()}/carteira`, 'Ver minha carteira')}`,
    ),
  };
}

export function emailCreditoConcedido(p: { nome: string; valor: string; motivo: string | null }) {
  return {
    assunto: 'Você recebeu crédito na sua carteira',
    html: layout(
      'Crédito na carteira',
      `<p>Olá, ${esc(p.nome)}. Os responsáveis pela sala colocaram <strong>${esc(p.valor)}</strong> de crédito na sua carteira.</p>
${p.motivo ? `<p>Motivo: ${esc(p.motivo)}</p>` : ''}
${botao(`${urlBase()}/carteira`, 'Ver minha carteira')}`,
    ),
  };
}

export function emailFaltaRegistrada(p: { nome: string; periodo: string }) {
  return {
    assunto: 'Falta registrada na sua reserva',
    html: layout(
      'Falta registrada',
      `<p>Olá, ${esc(p.nome)}. Os responsáveis pela sala registraram que a reserva de <strong>${esc(p.periodo)}</strong> não foi usada (falta).</p>
<p>Se isso não está certo, responda a este e-mail ou fale com os responsáveis.</p>
${botao(`${urlBase()}/minhas-reservas`, 'Ver minhas reservas')}`,
    ),
  };
}

export function emailCancelamentoConfirmado(p: { nome: string; periodo: string; credito: string | null; percentual: number; pago: boolean }) {
  const dinheiro = p.credito
    ? `<p>Pela política de cancelamento (${p.percentual}% do valor), <strong>${esc(p.credito)}</strong> virou crédito na sua carteira e pode ser usado numa nova reserva.</p>`
    : p.pago
      ? '<p>Pela política de cancelamento, não há crédito para este cancelamento, porque faltava pouco tempo para o horário.</p>'
      : '';
  return {
    assunto: 'Reserva cancelada',
    html: layout(
      'Reserva cancelada',
      `<p>Olá, ${esc(p.nome)}. Você cancelou a reserva de <strong>${esc(p.periodo)}</strong>. O horário foi liberado e o código de acesso, se havia, deixou de valer.</p>
${dinheiro}
${botao(`${urlBase()}/carteira`, 'Ver minha carteira')}`,
    ),
  };
}

export function emailCancelamentoAvisoAnfitriao(p: { nome: string; periodo: string; credito: string | null; statusAnterior: string }) {
  return {
    assunto: 'Reserva cancelada pelo profissional',
    html: layout(
      'Reserva cancelada',
      `<p>${esc(p.nome)} cancelou a reserva de <strong>${esc(p.periodo)}</strong> (estava ${esc(p.statusAnterior.replace('_', ' '))}). O horário voltou a ficar livre.</p>
${p.credito ? `<p>Crédito gerado na carteira da pessoa, pela política: ${esc(p.credito)}.</p>` : ''}
${botao(`${urlBase()}/agenda`, 'Ver a agenda')}`,
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
