// Pré-carregado só nos testes locais no navegador: desliga o envio real de e-mail (os e-mails
// aparecem no console do servidor). Uso: configuração 'web-sem-email' em .claude/launch.json.
process.env.RESEND_API_KEY = '';
// Servidor de teste em outra porta (quando a 3000 está ocupada): o login precisa aceitar essa origem.
process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'http://localhost:3001,http://127.0.0.1:3001';
