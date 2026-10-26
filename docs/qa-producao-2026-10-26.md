# Relatório de QA: produção e ambiente local (26/10/2026)

Versão testada: commit `ecb3d49` (E0 a E5 completas + redesign visual), publicado em `https://web-production-b82ba.up.railway.app`.

## 1. Resumo executivo

**Veredito: o sistema está sólido para um piloto fechado com as duas amigas, com ressalvas que cabem em um dia de trabalho.** Não encontrei nenhum defeito crítico nem vazamento de dados. A autorização, a proteção contra acesso cruzado, o webhook do Asaas, as migrações e o tratamento de HTML malicioso se comportaram como deveriam.

Foram encontrados **13 pontos de melhoria** (nenhum crítico, 4 de severidade média, 7 baixos e 2 informativos). Os que mais merecem atenção antes de abrir para mais gente:

1. Faltam **cabeçalhos de segurança HTTP** (QA-01).
2. A API de cadastro da biblioteca de login está aberta e **permite criar conta sem passar pelo formulário** (QA-02).
3. **Uma data inválida na URL derruba três telas com erro 500** (QA-03).
4. Quem **perde o e-mail de confirmação não tem como pedir outro** (QA-04).

| Medida | Resultado |
|---|---|
| Testes automatizados | 278 de 278 passam (25 arquivos), em execuções repetidas (2 execuções falharam por causa dos meus dados de QA e voltaram ao verde ao limpar, ver QA-10) |
| Tipos (TypeScript) e lint | sem erros |
| Build de produção (cópia limpa do commit) | compila, 25 rotas, sem avisos |
| Migrações num banco vazio | 10 migrações aplicam; 24 tabelas; seed idempotente |
| Rotas testadas em produção (sem login) | 38 URLs: nenhuma exposição indevida |
| Autorização (sessões reais, ambiente local) | correta nas 27 verificações de acesso |
| Páginas e ações com guarda de papel | 17 de 17 páginas, 3 de 3 layouts, 25 de 25 ações |
| Segredos no repositório e no histórico | nenhum |
| Acessibilidade: rótulos, títulos, rolagem horizontal | sem problemas nas mais de 15 telas auditadas (ver QA-07 a QA-09 para os pontos menores) |

## 2. Escopo, método e limites

O QA foi feito em **três frentes**:

- **Frente 1, produção sem login:** só leituras (GET/HEAD) e chamadas que não criam nada. Cobre rotas, redirecionamentos, cabeçalhos, API de autenticação, webhook, recibos, limite de requisições, erros e desempenho.
- **Frente 2, ambiente local com login:** o mesmo código de produção, com contas de teste (`qa-*@teste.local`, apagadas no final). Cobre os dois papéis, autorização cruzada, entradas maliciosas, webhook por HTTP real, worker, celular, modo escuro e acessibilidade.
- **Frente 3, qualidade do código e da infraestrutura:** build, migrações do zero, dependências, segredos, auditoria estática de autorização e estabilidade dos testes.

**Limite importante:** eu **não crio contas nem digito senhas em produção** (regra de segurança minha, mesmo a pedido). Por isso, o que exige login real em produção não foi executado por mim e está no roteiro da seção 7, para você executar. O fluxo básico em produção (cadastro, pedido, aprovação, Pix manual, código, recibo, cancelamento) você já validou em 25/10. As partes novas desde então (séries, redesign) foram verificadas no ambiente local, que roda o mesmo código.

## 3. O que foi testado e o resultado

### 3.1 Produção, sem login

| Área | Teste | Resultado |
|---|---|---|
| Rotas | 38 URLs (públicas, protegidas, dinâmicas com ID falso, API, arquivos sensíveis) | As 19 rotas protegidas (contando a raiz) redirecionam para `/login`. `/.env`, `/.git/config`, `/admin` e `/api` dão 404. |
| HTTPS | `http://` | redireciona (301) para `https://` |
| API de autenticação | `get-session` sem login | responde `null`, sem `Set-Cookie` |
| Recuperação de senha | e-mail inexistente | resposta genérica (não revela se a conta existe) |
| Redirecionamento aberto | `redirectTo` e `callbackURL` para site externo | bloqueados (403 `INVALID_REDIRECT_URL`) |
| Limite de requisições | 25 pedidos seguidos a uma rota de autenticação | 429 depois de poucas requisições; a janela leva ~30 s para liberar |
| Webhook do Asaas | sem token, token errado, GET, corpo de 300 KB sem token | 401, 401, 405, 401 (sem processar nada) |
| Recibos | sem login, ID falso e ID inválido | 401 |
| CORS | `OPTIONS` com origem de outro site | 204 sem cabeçalhos CORS |
| XSS refletido | `<script>` em parâmetros de URL | não é refletido na página |
| Páginas públicas | `lang=pt-BR`, `noindex`, 1 título por página, rótulos nos campos, sem recursos externos | OK. Contrato provisório presente e menção à LGPD |
| Desempenho | TTFB e tamanho | 0,26 a 0,38 s; 7 a 18 KB de HTML |

### 3.2 Ambiente local, com login

| Área | Teste | Resultado |
|---|---|---|
| Autorização cruzada | Profissional B tentando ver reserva, série, página de pagamento e recibo da A | **404 em todos** (nada vaza) |
| Áreas trocadas | profissional nas telas do Anfitrião e vice-versa (11 rotas) | redireciona para `/login?erro=acesso` |
| Acesso legítimo | 12 rotas do dono | 200 |
| Escalada de privilégio | cadastro bruto com `papel: "anfitriao"`, `ativo:false`, `emailVerified:true` | **ignorados** (continua profissional, não confirmado) |
| Entradas maliciosas | HTML/JavaScript no nome e no motivo de recusa | escapado nas telas e nos corpos dos e-mails (assunto: ver QA-06) |
| IDs e datas malformados | UUID inválido, SQL na URL | 404 (sem 500). Datas absurdas: ver QA-03 |
| Login | senha errada; conta não confirmada | mensagens corretas (403 `EMAIL_NOT_VERIFIED`). Ver QA-04 |
| Fluxos do Anfitrião (nesta rodada, pós-redesign) | recusar pedido, aprovar pedido, marcar pagamento, enviar código de acesso | funcionam; avisos e e-mails corretos. Aprovar série, marcar pacote e cancelar série foram verificados em 25/10 |
| Fluxos da profissional (nesta rodada, pós-redesign) | cancelar com prévia (100%), crédito oferecido no resumo do pedido, telas de série e carteira | funcionam; valores exatos. Pedir série, renovação preenchida e cancelar série (50% + 100% = R$ 67,50) foram verificados em 25/10 |
| Webhook por HTTP real | valor divergente, pagamento do pacote da série, duplicado, cobrança já paga, evento desconhecido, JSON inválido | todos tratados; 1 recibo; erro de valor registrado |
| Worker | subida e agendamentos | 7 agendamentos registrados; job de expiração rodou sem falhas |
| Celular (375 px) | 6 páginas | sem rolagem horizontal |
| Modo claro e escuro | contraste e leitura | ver QA-07 |
| Acessibilidade | mais de 15 telas dos dois papéis | campos com rótulo, 1 `h1`, sem salto de título, nomes em botões e links |

### 3.3 Código e infraestrutura

| Área | Resultado |
|---|---|
| Auditoria estática | toda página, layout e ação do servidor tem guarda do papel certo (a única sem guarda é o cadastro, público por natureza) |
| Migrações do zero | banco vazio, 10 migrações, extensão `btree_gist`, as 2 restrições `EXCLUDE` da agenda, seed rodado 2 vezes sem duplicar |
| Dependências | `npm audit --omit=dev`: 6 avisos (ver QA-12) |
| Segredos | nenhuma chave no repositório nem no histórico (`.env` ignorado; só valores de exemplo/CI locais) |
| Estabilidade | execuções completas repetidas dos testes: sem intermitência (as duas falhas que apareceram foram causadas pelos meus dados de QA, ver QA-10) |

## 4. Achados

Severidade: **Média** (corrigir antes de abrir a mais gente), **Baixa** (melhoria que cabe no backlog), **Info** (observação).

| ID | Sev. | Resumo | Esforço |
|---|---|---|---|
| QA-01 | Média | Sem cabeçalhos de segurança HTTP; `x-powered-by` exposto | P |
| QA-02 | Média | API bruta de cadastro cria conta sem CPF, registro e aceite | P |
| QA-03 | Média | Data inválida na URL causa erro 500 em 3 telas | PP |
| QA-04 | Média | Sem reenvio do e-mail de confirmação; sem aviso após confirmar | P |
| QA-05 | Baixa | Formulários sem `method="post"`: dado pode ir para a URL antes da hidratação | PP |
| QA-06 | Baixa | Assunto de e-mail não é saneado | PP |
| QA-07 | Baixa | Contraste abaixo de 4,5:1 em links e textos no modo claro | PP |
| QA-08 | Baixa | Alvos de toque de 18 a 20 px (mínimo recomendado: 24 px) | PP |
| QA-09 | Baixa | Títulos de página genéricos em algumas telas | PP |
| QA-10 | Baixa | Testes compartilham o banco de desenvolvimento e usam CPFs fixos | M |
| QA-11 | Baixa | Contêiner roda como root, sem healthcheck | P |
| QA-12 | Info | 6 avisos de `npm audit` em ferramentas de build | P |
| QA-13 | Info | Página 404 em inglês; fila "Aguardando pagamento" mostra o valor cheio | PP |

Esforço: PP = menos de 1 hora, P = 1 a 3 horas, M = meio dia.

### QA-01 (Média): sem cabeçalhos de segurança HTTP

- **Evidência:** `curl -I /login` em produção devolve apenas `Cache-Control`, `Content-Type`, `Server` e `x-powered-by: Next.js`. Faltam `Content-Security-Policy`, `X-Frame-Options` (ou `frame-ancestors`), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` e `Strict-Transport-Security`. `next.config.ts` está vazio.
- **Impacto:** as telas do Anfitrião (aprovar pedido, marcar pagamento) podem ser embutidas em outro site (*clickjacking*). Sem HSTS, a primeira visita por `http://` fica exposta até o redirecionamento. O cabeçalho `x-powered-by` entrega a tecnologia.
- **Sugestão:** em `next.config.ts`, `poweredByHeader: false` e uma função `headers()` com: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` restritivo, `Strict-Transport-Security: max-age=31536000; includeSubDomains` e uma CSP começando em modo `Content-Security-Policy-Report-Only` (liberar a origem do Sentry em `connect-src`).
- **Aceite:** `curl -I` mostra os cabeçalhos; as telas continuam funcionando; nenhuma violação de CSP no console durante um fluxo completo.

### QA-02 (Média): cadastro pela API bruta contorna o formulário

- **Evidência:** `POST /api/auth/sign-up/email` com nome, e-mail e senha cria o usuário (HTTP 200), **sem** linha em `profissional` (sem CPF, registro no conselho nem aceite do contrato). O campo `papel` enviado no corpo é ignorado (sem escalada de privilégio), e `emailVerified` também.
- **Impacto:** abre caminho para contas órfãs e para disparar e-mails de confirmação para endereços de terceiros (limitado pelo limite de requisições). Contas órfãs não conseguem usar o sistema (as guardas as barram), então o risco é de ruído e abuso, não de acesso indevido.
- **Sugestão:** bloquear o endpoint público e manter só o cadastro pelo servidor. Em Better Auth, usar um `hooks.before` que recuse `/sign-up/email` quando a chamada vem de uma requisição HTTP (`ctx.request` presente) e deixe passar a chamada interna de `cadastrarProfissional` e dos scripts de criação dos Anfitriões. Alternativa: `emailAndPassword.disableSignUp` e criar contas por API interna dedicada.
- **Aceite:** o `POST` externo devolve erro; o cadastro pelo formulário e `npm run anfitrioes:criar` continuam funcionando; teste automatizado cobrindo os dois casos.

### QA-03 (Média): data inválida na URL causa erro 500

- **Evidência:** `/reservar?data=9999-99-99`, `/reservar/resumo?data=9999-99-99&unidade=hora&de=9&ate=10` e `/agenda?data=9999-99-99` (logado) retornam **500**. Causa: `parseDataISO` aceita mês 99 e dia 99 (vira o ano 10007) e o Postgres rejeita (`time zone displacement out of range`). Também aceita `2026-02-31` (vira 03/03 silenciosamente).
- **Impacto:** tela de erro para quem editar a URL (ou seguir um link corrompido), e ruído no Sentry. Não expõe dados.
- **Sugestão:** validar de verdade em `parseDataISO`/`dataValida` (mês 1 a 12, dia existente no mês, ano entre 2000 e 2100) e tratar data fora do intervalo como "usar o dia padrão". Acrescentar testes para `9999-99-99`, `2026-02-31`, `0000-01-01` e texto qualquer.
- **Aceite:** as três URLs acima respondem 200 com o dia padrão; testes novos passam.

### QA-04 (Média): sem reenvio de confirmação de e-mail

- **Evidência:** o link vale 1 hora; o login de conta não confirmada devolve 403 e **não envia outro e-mail**; a tela só diz "Confirme seu e-mail antes de entrar". Depois de confirmar, a pessoa cai no login **sem nenhuma mensagem**.
- **Impacto:** uma amiga que demorar mais de 1 hora fica sem conseguir entrar, dependendo de você para resolver. Esse é o ponto de atrito mais provável do piloto.
- **Sugestão:** ligar `emailVerification.sendOnSignIn: true`, mostrar na tela de login um botão "Reenviar e-mail de confirmação" quando o erro for `EMAIL_NOT_VERIFIED`, e, após confirmar, redirecionar para `/login?aviso=email_confirmado` com a mensagem "E-mail confirmado. Entre com a sua senha." (o padrão `?aviso=` já existe no login). Padronizar o visual do e-mail de confirmação e de redefinição de senha com o mesmo modelo dos demais.
- **Aceite:** com link vencido, a pessoa consegue pedir outro e entrar; mensagem de sucesso aparece após confirmar.

### QA-05 (Baixa): formulários sem `method="post"`

- **Evidência:** ao clicar em "Entrar" antes de a página terminar de carregar (no desenvolvimento a hidratação leva ~11 s), o navegador envia o formulário como GET e a URL vira `/login?email=...&senha=...`. Em produção o formulário de login só aparece depois do JavaScript (nenhum `<input>` no HTML do servidor), então o risco é muito menor. `/esqueci-senha` vem renderizada pelo servidor (o e-mail iria para a URL).
- **Impacto:** a senha na URL ficaria em histórico, logs e cabeçalho `Referer`. Hoje improvável em produção, mas frágil: depende de um detalhe de renderização.
- **Sugestão:** `method="post"` nos três formulários (login, esqueci a senha, redefinir senha) e desabilitar o botão até a hidratação.
- **Aceite:** um envio antes da hidratação não deixa dados na URL.

### QA-06 (Baixa): assunto do e-mail não é saneado

- **Evidência:** com nome `<script>alert("xss")</script> QA Xss`, o corpo do e-mail sai escapado, mas o **assunto** traz o texto cru.
- **Impacto:** clientes de e-mail tratam o assunto como texto, então o risco é baixo, mas é melhor não carregar marcação nem quebras de linha em cabeçalho.
- **Sugestão:** função única `assuntoSeguro()` que remove `<`, `>` e quebras de linha e limita o tamanho, aplicada em todos os assuntos dinâmicos (nome do profissional).

### QA-07 (Baixa): contraste no modo claro

- **Evidência:** auditoria automática: links azuis (`#0071e3` sobre `#f5f5f7`) = **4,3:1** (mínimo 4,5:1 para texto de 14 px); texto de dias desabilitados 2,2 a 4,4:1; contador "pedido(s) para aprovar" no menu = 3,5:1 (12 px). O modo escuro passou sem falhas.
- **Sugestão:** usar um tom de azul um pouco mais escuro para **texto** (por exemplo `#0066cc`, cerca de 5:1) e manter `#0071e3` só em fundos de botão; escurecer os textos de apoio e o contador.
- **Aceite:** a auditoria de contraste não aponta falhas nos dois modos.

### QA-08 (Baixa): alvos de toque pequenos

- **Evidência:** links como "← Minhas reservas" medem 18 px de altura e linhas de lista de datas, 20 px.
- **Sugestão:** `padding` vertical nesses links e nas linhas clicáveis para chegar a 24 px (ideal 44 px no celular).

### QA-09 (Baixa): títulos de página genéricos

- **Evidência:** `/login`, `/esqueci-senha`, `/redefinir-senha`, `/inicio` e `/agenda` mostram o título "Painel da sala" na aba.
- **Impacto:** acessibilidade (WCAG 2.4.2) e dificuldade de distinguir abas.
- **Sugestão:** `metadata`/`generateMetadata` por página (páginas de cliente ganham um `layout.tsx` de segmento com o título).

### QA-10 (Baixa): testes e desenvolvimento no mesmo banco

- **Evidência:** ao criar contas de QA com os CPFs de exemplo, 2 testes de cadastro falharam ("CPF em uso"). A suíte usa CPFs e e-mails fixos e roda no mesmo banco do desenvolvimento.
- **Impacto:** dados reais do ambiente local podem quebrar testes (e os testes apagam e inserem dados nesse banco).
- **Sugestão:** banco separado `subloc_test` (um `globalSetup` do Vitest cria e migra) e CPFs gerados por teste.

### QA-11 (Baixa): contêiner

- **Evidência:** `Dockerfile` sem `USER` (roda como root), imagem única com dependências de desenvolvimento, sem `HEALTHCHECK`.
- **Sugestão:** `USER node`, build em dois estágios e healthcheck em `/login` configurado no Railway (reinicia o serviço se travar).

### QA-12 (Info): `npm audit`

- **Evidência:** 6 avisos em produção: 1 alto e 4 moderados ligados ao PostCSS embutido no Next 15.5.28 (processamento de CSS no build) e 1 moderado em `esbuild`/`drizzle-kit` (ferramentas de build e migração). Nenhum é alcançável por usuários em tempo de execução.
- **Sugestão:** acompanhar o patch do Next 15.5.x e atualizar `drizzle-kit`; incluir `npm audit` no CI, sem bloquear, para ser avisado. A correção sugerida pelo `npm audit fix --force` (Next 16) é uma atualização grande: não aplicar às pressas.

### QA-13 (Info): detalhes de acabamento

- A página 404 aparece em inglês ("This page could not be found"): criar `not-found.tsx` em português.
- A fila de **Solicitações → Aguardando pagamento** mostra o valor cheio da reserva, e não o valor a pagar depois do crédito (a página da reserva mostra o valor certo).
- "Renovar série" aparece em qualquer momento da série, não só perto do fim (decisão de produto: manter ou limitar à janela de aviso de 7 dias).

## 4.1 Situação das correções (atualizado depois da Onda 1)

A Onda 1 foi implementada em 27/10/2026, **um commit por item, com testes, ainda sem publicar** (o `git push` fica com você). Estado do código: 332 testes passando (eram 278), lint e tipos limpos.

| ID | Situação | Commit | O que foi feito e como foi verificado |
|---|---|---|---|
| QA-04 | Corrigido | `7e1eb70` | Login reenvia o link a quem tenta entrar sem confirmar (senha certa); botão "Reenviar e-mail de confirmação"; depois de confirmar, volta ao login com "E-mail confirmado"; e-mails de confirmação e de redefinição no modelo padrão. 7 testes com a biblioteca de login de verdade; mutação detectada; conferido no navegador. |
| QA-03 | Corrigido | `6438fb9` | `parseDataISO` só aceita datas que existem (mês 1 a 12, dia do mês, ano 2000 a 2100). 31 testes novos; as três telas que davam 500 agora respondem 200 (ou redirecionam) em build de produção. |
| QA-02 | Corrigido | `5bad6f5` | A rota pública `POST /api/auth/sign-up/email` responde 403. O cadastro pelo formulário e o script dos Anfitriões (chamadas internas) seguem funcionando. Mutação detectada. |
| QA-01 | Corrigido | `8a4921c` | `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS e CSP em modo de observação; `x-powered-by` removido. Conferido com `curl` num build de produção local (cabeçalhos em páginas, API e 404) e sem nenhuma violação da CSP em 6 telas. |
| QA-05 | Corrigido | `1efb7f1` | Formulários de login, esqueci-senha e redefinir-senha com `method="post"` e botão desabilitado até a página carregar. Conferido no navegador (antes de carregar: POST e botão desabilitado; depois: habilitado); mutação detectada. |
| QA-06 | Corrigido | `d77268f` | `assuntoSeguro()` aplicado em `notificar` e em `enviarEmail`. Mutação detectada. |

**Atenção ao publicar a Onda 1:**
- **HSTS** passa a valer: depois da primeira visita, os navegadores só falam HTTPS com o domínio por 1 ano. Como o Railway já serve HTTPS, é o desejado.
- A **CSP está em modo de observação**: não bloqueia nada. Depois de uns dias de uso real sem violações no console (F12), a troca para bloqueio é uma linha (`MODO_CSP` em `src/lib/cabecalhos.ts`).
- Com o link de confirmação vencido, a pessoa agora recebe um novo ao tentar entrar. Vale testar com uma conta de teste em produção (roteiro, item 4 da seção 7), já que lá os e-mails dependem do domínio verificado no Resend.

Os itens da Onda 2 e a parte de operação continuam abertos, como descrito abaixo.

## 5. Plano de correção

**Onda 1: antes de abrir para as amigas (meio dia de trabalho). FEITA, aguardando publicação**

| Ordem | Item | Esforço | Dono |
|---|---|---|---|
| 1 | QA-04: reenviar confirmação, aviso pós-confirmação, e-mail padronizado | P | Código |
| 2 | QA-03: validar data (e testes) | PP | Código |
| 3 | QA-02: bloquear cadastro bruto | P | Código |
| 4 | QA-01: cabeçalhos de segurança (CSP em modo relatório) | P | Código |
| 5 | QA-05 e QA-06: `method="post"` e assunto seguro | PP | Código |

**Onda 2: antes do lançamento público (E6)**

| Item | Esforço |
|---|---|
| QA-07, QA-08, QA-09 e QA-13 (acessibilidade e acabamento) | P |
| QA-11 (contêiner e healthcheck), CSP passando de relatório para bloqueio | P |
| QA-10 (banco de testes separado) | M |
| QA-12 (`npm audit` no CI e atualização do Next quando houver patch) | P |

**Operação e conformidade (não são código)**

- Domínio verificado no Resend (sem ele só você recebe e-mail).
- Conferir o backup diário do Postgres no Railway e **fazer um teste de restauração** em um banco novo.
- Monitor de disponibilidade externo (por exemplo, UptimeRobot) para o `web`, e um alerta quando o `worker` parar de gerar batimentos.
- Rate limit e proteção anti-robô no cadastro (CAPTCHA) antes do lançamento público.
- Revisão por advogado do contrato e do termo (hoje provisórios) e política de privacidade; conversa com o contador antes de ligar o Asaas real.

Ofereço fazer a **Onda 1** na sequência, em um commit pequeno por item, com testes.

## 6. O que está bem (para manter)

- Autorização: guarda do papel em toda página, layout e ação, e dono verificado nas telas de detalhe (nenhum acesso cruzado vaza, nem por ID adivinhado).
- Webhook do Asaas: token comparado em tempo constante, idempotente, confere valor e referência, trata falha de forma reexecutável, e nunca devolve 500 por dado ruim.
- Dinheiro: sempre em centavos, regras de crédito e política com testes de concorrência.
- Limite de requisições ativo em produção; redirecionamentos externos bloqueados; respostas genéricas na recuperação de senha.
- Migrações reprodutíveis do zero, seed idempotente, restrições de conflito de agenda no banco.
- E-mails com HTML escapado; páginas com `noindex`; sem recursos externos nas páginas públicas; desempenho bom (TTFB 0,3 s).

## 7. Roteiro para você executar em produção (com login)

Use uma conta de teste (por exemplo, `seuemail+teste@gmail.com`, confirmada por SQL, como feito em 25/10) e apague-a no final.

1. **Cookies da sessão:** depois do login, em F12 → Application → Cookies, o cookie `better-auth.session_token` deve ter `HttpOnly`, `Secure` e `SameSite=Lax`.
2. **Série em produção:** peça uma série curta (2 datas) em "Reserve um horário fixo"; como Anfitrião, aprove na fila de Solicitações; marque o pagamento do primeiro mês; como profissional, veja o recibo e cancele a série; confira o crédito na Carteira.
3. **Celular real:** abra o login, Reservar e Minhas reservas no seu telefone, nos dois modos (claro e escuro).
4. **E-mails reais:** confirme que chegam (aprovação, pagamento, código, cancelamento) e que o link "Ver a reserva" abre a página certa.
5. **Worker em produção:** no log, `[worker] no ar` e, após alguns minutos, o batimento a cada 5 minutos, sem erros.
6. **Asaas (quando for ligar):** com `ASAAS_ATIVO=true` só no sandbox primeiro, aprove um pedido e confira o Pix online e a confirmação automática pelo webhook real.
7. **Limpeza:** apague as contas e reservas de teste com o comando de limpeza (peça que eu o prepare).

## 8. Anexo: o que foi criado e removido

Para o QA foram criados, **e já removidos**: contas `qa-*@teste.local` e suas reservas, séries, cobranças, recibos e créditos no banco **local**; um banco temporário `qa_zero` (apagado); uma cópia do código para o build (apagada); scripts temporários (`scripts/qa-dados.ts`). Nada foi criado nem alterado em **produção**: os únicos pedidos feitos a ela foram leituras e chamadas rejeitadas (token inválido, e-mail inexistente), que não gravam dados.
