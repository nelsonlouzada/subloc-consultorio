// Pré-carregado só nos testes locais no navegador: desliga o envio real de e-mail (os e-mails
// aparecem no console do servidor). Uso: configuração 'web-sem-email' em .claude/launch.json.
process.env.RESEND_API_KEY = '';
