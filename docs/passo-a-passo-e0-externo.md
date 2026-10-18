# Passo a passo: o que você faz por fora na Etapa E0

Data: 2026-10-18 · Base: [plano-de-entregas.md](plano-de-entregas.md), seção E0 e pendências externas.

As telas e os nomes de botões dos serviços mudam de tempos em tempos. Se algo não estiver igual, siga o sentido do passo.

**Regra de ouro:** chaves e senhas nunca vão para o git nem para o chat. Guarde-as num gerenciador de senhas e cole só nos lugares indicados (arquivo `.env` local e variáveis do Railway).

## Ordem sugerida

| # | Passo | Tempo | Depende de |
|---|---|---|---|
| 1 | Docker Desktop | 15 min | nada |
| 2 | Repositório no GitHub | 5 min | nada |
| 3 | Conta Asaas sandbox | 15 min | nada |
| 4 | Conta Resend | 10 min | nada |
| 5 | Projeto Sentry | 10 min | nada |
| 6 | Railway: Postgres, web e worker | 30 min | 2 |
| 7 | Passar as chaves para mim | 5 min | 3, 4, 5, 6 |

Os passos 1 a 5 são independentes: faça na ordem que preferir.

---

## 1. Docker Desktop (banco local)

1. Baixe em docker.com/products/docker-desktop e instale. Aceite a opção de usar **WSL 2** se perguntar.
2. Reinicie o computador se o instalador pedir.
3. Abra o Docker Desktop e espere o ícone da baleia ficar verde ("Engine running").
4. Num terminal novo, confira:
   ```
   docker --version
   ```
5. Avise-me. Eu subo o banco, a migração e valido o login.

## 2. Repositório no GitHub

1. Em github.com, crie um repositório **privado** chamado `subloc-consultorio` (sem README, sem .gitignore, sem licença).
2. Copie a URL do repositório (`https://github.com/<seu-usuario>/subloc-consultorio.git`).
3. Me envie a URL. Eu conecto o repositório local e faço o primeiro push.
4. O CI roda sozinho a cada push (lint, tipos, testes, build). Se falhar, eu corrijo.

## 3. Conta Asaas sandbox (teste de risco)

Objetivo: descobrir **agora** se algo bloqueia pessoa física. Isto é só o ambiente de testes; não envolve dinheiro real.

1. Acesse **sandbox.asaas.com** (é um site separado do Asaas real) e crie uma conta de testes.
2. Dentro do sandbox, vá em **Integrações → Chaves de API** (o caminho pode estar em *Minha Conta → Integrações*) e gere uma **chave de API**. Ela começa com `$aact_hmlg_`.
3. Vá em **Integrações → Webhooks** e crie um webhook:
   - URL: por enquanto deixe para depois do passo 6 (será `https://<seu-web>.up.railway.app/api/webhooks/asaas`). Para testar local antes disso, eu uso um túnel temporário e você só atualiza a URL.
   - Eventos: marque os de **cobrança** (pagamento recebido, confirmado, vencido).
   - Defina um **token de autenticação** (uma senha longa e aleatória). Anote.
4. No sandbox, tente **cadastrar uma chave Pix** na conta (menu de Pix). Anote o que acontecer. Se pedir algo que pessoa física não tem, isso é justamente o risco que queremos descobrir.
5. Anote também as **taxas** que o sandbox mostra para Pix e cartão, para comparar com a visão (R$ 1,99 no Pix; R$ 0,49 + 2,99% no cartão).
6. O que me enviar (pelo `.env`, não pelo chat): chave de API sandbox e token do webhook.

**Resultado esperado:** eu rodo um script que cria um cliente com CPF, cria uma cobrança Pix, você a "paga" pelo painel do sandbox e o webhook chega. Se qualquer etapa falhar, vamos saber o motivo antes de investir nas etapas seguintes.

## 4. Conta Resend (e-mail)

1. Crie a conta em resend.com.
2. Em **API Keys**, crie uma chave com permissão **Sending access**. Copie (aparece uma vez só).
3. **Sem domínio verificado**, o Resend só envia para o **seu próprio e-mail** da conta, usando o remetente `onboarding@resend.dev`. Isso basta para a E0 (verificação de e-mail dos dois Anfitriões, se usarem o seu endereço).
4. Para enviar a terceiros (necessário na **E2**), é preciso verificar um domínio:
   - Em **Domains → Add Domain**, informe o domínio ou subdomínio (do Hub SaaS, ou um domínio provisório que você tenha).
   - O Resend mostra registros DNS (SPF, DKIM e outros). Cadastre-os no painel de DNS de quem controla o domínio e clique em **Verify**.
   - Se o domínio do Hub ainda não estiver pronto, pode registrar um domínio provisório barato só para isso.
5. Guarde a chave (`RESEND_API_KEY`).

## 5. Projeto Sentry

1. Crie a conta em sentry.io (plano gratuito).
2. Crie um projeto, plataforma **Next.js**, nome `subloc-consultorio`.
3. Copie o **DSN** (algo como `https://...@...ingest.sentry.io/...`).
4. Sugestão: crie um segundo projeto, plataforma **Node.js**, para o worker, e copie o DSN dele também.
5. Guarde os DSNs. Eu faço a integração no código quando você me passar.

## 6. Railway: Postgres, web e worker

1. Entre em railway.com. O plano de teste é limitado; para uso contínuo, assine o plano **Hobby** (cerca de US$ 5/mês, com uso cobrado à parte; estimativa do projeto: US$ 5 a 20/mês).
2. **New Project → Empty Project**. Nomeie `subloc-consultorio`.
3. **Postgres:** *+ New → Database → Add PostgreSQL*. O Railway cria o banco e a variável `DATABASE_URL`.
   - Em **Backups** do serviço do banco, ative o backup diário (se disponível no seu plano; senão, anote para resolver antes da E2).
   - Depois de criado, confira que a extensão `btree_gist` pode ser criada (a E1 precisa dela). Eu testo isso com um comando.
4. **Serviço web:** *+ New → GitHub Repo →* escolha `subloc-consultorio` (depois do passo 2 e do primeiro push).
   - Nome do serviço: `web`.
   - Em **Variables**, adicione:
     - `DATABASE_URL` → referência ao banco (`${{Postgres.DATABASE_URL}}`)
     - `BETTER_AUTH_SECRET` → uma chave aleatória longa (gere com um gerenciador de senhas, 32+ caracteres)
     - `BETTER_AUTH_URL` → a URL pública do serviço (depois do passo seguinte)
     - `RESEND_API_KEY`, `EMAIL_REMETENTE`
     - `NODE_ENV=production`
   - Em **Settings → Networking**, clique em **Generate Domain** para obter a URL pública. Volte e preencha `BETTER_AUTH_URL` com ela.
5. **Serviço worker:** *+ New → GitHub Repo →* o mesmo repositório.
   - Nome: `worker`.
   - Em **Settings → Deploy**, defina o **Start Command** como `npm run worker`.
   - Variáveis: `DATABASE_URL` (mesma referência) e `NODE_ENV=production`.
   - Não gere domínio público para o worker.
6. **Migração em produção:** no serviço `web`, em **Settings → Deploy**, defina **Pre-deploy Command** como `npm run db:migrar`. Assim cada deploy aplica as migrações.
7. Depois do primeiro deploy, abra a URL do web. Deve aparecer a página inicial. No log do `worker`, procure `[worker] no ar`.
8. **Anfitriões em produção:** com o Railway CLI instalado e logado (`railway login`, `railway link`), rode `railway run npm run anfitrioes:criar` com as variáveis `ANFITRIAO_*` configuradas só nessa execução. Posso conduzir este passo com você quando chegar nele.

## 7. O que me passar no fim

Nunca cole chaves no chat. Coloque no `.env` local (que não vai para o git) e avise "preenchi". Preciso de:

- `RESEND_API_KEY`
- `ASAAS_API_KEY` (sandbox) e `ASAAS_WEBHOOK_TOKEN`
- DSNs do Sentry
- URL do repositório e URL pública do Railway (essas podem ir no chat, não são segredos)
- E-mail e nome dos dois Anfitriões (as senhas eu gero)

## Critério de pronto da E0 (do plano)

- Vocês dois entram no sistema pela URL de produção.
- O teste do Asaas sandbox passou: cliente com CPF, cobrança Pix e webhook recebido.
