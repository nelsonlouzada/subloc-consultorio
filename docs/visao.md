# Subloc_Consultorio — Documento de Visão (rascunho v0.4)

Data: 2026-10-17 · Status: discussão, nada codificado. Decidido construir um sistema próprio (caminho B do [comparativo](comparativo-sublocando.md)).

## 1. Resumo

Uma plataforma para ocupar a ociosidade de **uma sala de consultório**, alugada pelos donos e usada pela esposa em parte da semana. Nos horários livres, profissionais de saúde mental (psiquiatras, psicólogos e terapeutas) se cadastram, veem a disponibilidade, pedem reserva e pagam online. Os donos aprovam, acompanham a agenda e o financeiro.

**Objetivo:** gerar renda extra com o espaço ocioso. Não é, por ora, um produto para vender a outros donos de consultório.

## 2. Escopo e não-escopo

**Dentro:** uma sala; um único Anfitrião (os donos); Profissionais externos; página pública da sala; reserva por hora, turno ou dia; reservas recorrentes; aprovação manual; pagamento antecipado online; créditos e banco de horas; financeiro; contrato e termo com aceite digital; código de acesso à fechadura.

**Fora (por enquanto):** multi-tenant/venda para outros consultórios; planos de assinatura da plataforma; nota fiscal (recebimento como pessoa física); caução e taxa de cadastro; integração com o iConsultório (a agenda da esposa é independente, os dias dela são bloqueados manualmente).

Decisão de desenho: modelar o **espaço** como entidade (e não como constante no código), sem construir nada multi-tenant. Custa pouco e preserva a opção.

## 3. Atores

- **Anfitrião:** os donos. Aprovam cadastros e reservas, definem preços e regras, bloqueiam datas, veem o financeiro.
- **Profissional:** quem reserva (psiquiatra, psicólogo, terapeuta).

## 4. Regras de negócio

Tudo marcado como parametrizável deve ser editável pelo Anfitrião, sem mexer no código.

### 4.1 Funcionamento e turnos (parametrizável)
- Segunda a sábado, das 07h às 22h. Domingo fechado.
- Turno 1: 07h–12h (5h). Turno 2: 13h–22h (9h). Os turnos são fixos.
- A hora 12h–13h é a trava natural entre os turnos (ver 4.3). Pode ser reservada avulsa quando não há turno 1 de outro profissional.
- Unidades de reserva: **hora**, **turno** ou **dia inteiro** (07h–22h, incluindo 12h–13h).

### 4.2 Preços (parametrizável)
Valores iniciais (cada turno tem o seu preço):

| Unidade | Horas | Preço | R$/hora |
|---|---|---|---|
| Hora avulsa | 1 | R$ 50 | 50 |
| Turno 1 (07h–12h) | 5 | R$ 200 | 40 |
| Turno 2 (13h–22h) | 9 | R$ 300 | 33 |
| Dia inteiro (07h–22h) | 15 | R$ 450 | 30 |

- A hora avulsa fica no topo do mercado (R$ 25 a R$ 55). Quem usa mais paga menos por hora via turno, dia, pacote do mês (4.5) e banco de horas (4.10).
- Quatro horas avulsas (R$ 200) igualam o turno 1; seis horas (R$ 300) igualam o turno 2.
- Dia (450) < turno 1 + turno 2 (500): é um desconto.
- Cobrar sempre o **menor preço possível** para o conjunto de horas pedido (soma das horas, turno ou dia), para o Profissional nunca pagar mais por pedir mais.
- Preços por dia da semana, horário nobre e por Profissional ficam preparados na estrutura, mesmo sem uso no início.

### 4.3 Limites da reserva (parametrizável)
- Antecedência **mínima de 24h** e **máxima de 60 dias**.
- Duração **mínima de 1 hora**. A grade é sempre em **horas cheias**.
- **Trava de 1 hora cheia** entre Profissionais diferentes (duração parametrizável):
  - Quem reserva 9h–10h trava 10h–11h. O próximo Profissional só pode começar às 11h.
  - Vale nos dois sentidos: se já existe reserva às 11h, a hora 10h–11h não pode ser reservada por outro Profissional.
  - O mesmo Profissional pode emendar horas sem trava (9h–10h e 10h–11h).
  - O uso da sala pela esposa conta como um Profissional e também gera trava (ver 4.7).
- Custo da regra: com reservas avulsas de 1 hora, a sala atende no máximo cerca de metade das horas do dia. Reservas de turno e de dia quase não são afetadas.

### 4.4 Fluxo da reserva
1. O Profissional escolhe o horário e solicita. O horário fica **retido**.
2. O Anfitrião aprova ou recusa.
3. Se aprovada, o Profissional recebe o link de pagamento (Pix ou cartão) com **prazo de validade** (parametrizável, sugestão: 2 horas).
4. Pago no prazo: **confirmada**. Fora do prazo: o horário é liberado e a reserva expira.
5. Confirmada a reserva, o código de acesso é enviado (manual na fase 1, automático na fase 2).

Pagamento é **sempre antecipado**. Evolução prevista: Profissionais de confiança com aprovação automática.

### 4.5 Reserva recorrente
- O Profissional pede uma série (ex.: toda terça à tarde, por X semanas). O Anfitrião aprova a série de uma vez.
- A série gera ocorrências individuais, cada uma com seu horário e seu valor.
- **Pagamento: o Profissional escolhe** entre:
  - **pacote do mês**: um pagamento cobre todas as ocorrências do mês, com **10% de desconto** (parametrizável);
  - **por ocorrência**: um link com prazo antes de cada data, sem desconto.
- Ocorrência cancelada de um pacote pago segue a política de 4.6 e vira crédito sobre o valor com desconto.
- Cobrança recorrente automática no cartão e lembrete a cada recorrência ficam para a **fase 2**.

### 4.6 Cancelamento, remarcação e falta (parametrizável)
Política inicial, valores ajustáveis:
- Cancelamento com 48h ou mais de antecedência: crédito de 100%.
- Entre 48h e 24h: crédito de 50%.
- Menos de 24h ou falta: sem devolução.
- Forma de devolução: **crédito** na plataforma, para evitar taxa de estorno. Reembolso em dinheiro fica como exceção do Anfitrião.
- **Remarcação = cancelamento + nova reserva.** O cancelamento segue a política acima, o crédito paga a nova reserva, e a nova reserva passa pela aprovação normalmente.

### 4.7 Bloqueios
O Anfitrião bloqueia datas e horários. Bloqueios têm prioridade sobre qualquer reserva. São de dois tipos:
- **Uso próprio** (atendimentos da esposa): conta como um Profissional e gera a trava de 1 hora antes e depois.
- **Indisponível** (manutenção, feriado, folga): só fecha o horário, sem trava.

### 4.8 Contrato e termo
- Contrato simplificado, aceito uma vez no cadastro.
- Termo de uso aceito a cada reserva.
- Registrar data, hora, IP e versão do texto aceito.
- A redação final deve ser revista por advogado (ver riscos).

### 4.9 Acesso físico
Fechadura inteligente, ainda não comprada. **Requisito de compra:** modelo com API ou integração que permita criar códigos temporários. Até lá, envio manual do código.

### 4.10 Créditos e banco de horas (parametrizável)
- Cada Profissional tem uma **carteira de créditos em reais**.
- A carteira recebe crédito de duas formas: **cancelamentos** (4.6) e **compra de pacote de crédito com bônus** (o banco de horas).
- Exemplo de pacote: paga R$ 450 e recebe R$ 500 de crédito. Faixas e bônus definidos pelo Anfitrião.
- O crédito paga qualquer reserva: hora, turno, dia, ocorrência ou pacote do mês.
- **Validade** do crédito: sugestão de 90 dias, parametrizável.

## 5. Cadastro do Profissional
- Campos: nome, CPF, e-mail, telefone, profissão, número do registro profissional (CRM, CRP ou outro conselho) e UF.
- Verificação **manual**: o Anfitrião confere o registro no site do conselho antes de aprovar.
- Sem upload de documentos (menos dado sensível guardado).

## 6. Financeiro e pagamento
- Gateway: **Asaas**, conta de pessoa física, com Pix e cartão. Tem API de cobrança e de assinatura, útil para a fase 2.
- Taxas padrão publicadas (indicativas, confirmar na simulação da conta): Pix R$ 1,99 por cobrança paga; cartão à vista R$ 0,49 + 2,99%.
- Atenção: Pix recebido por pessoa física pode ser tarifado em uso comercial, acima de 30 recebimentos/mês ou com QR Code dinâmico. Confirmar com o Asaas e o contador.
- Lançamento automático de cada pagamento, crédito, devolução e estorno.
- Relatório mensal de receitas (apoio ao carnê-leão), com recibo por reserva.
- Pessoa física no início, sem emissão de nota.

## 7. Marca, domínio e captação
- **Marca e domínio** vêm do Hub SaaS (projeto separado, em desenvolvimento). O Hub fornece só isso: login, pagamentos e cadastro continuam neste sistema.
- **Endereço: subdomínio** do Hub (ex.: sala.seuhub.com.br). Deploy independente, apenas um registro de DNS, sem depender do código do Hub.
- **Captação:**
  - **Página pública da sala** (fase 1): fotos, localização, o que está incluso, preços e acesso ao cadastro. A agenda só aparece depois do login (ver [jornadas-e-telas.md](jornadas-e-telas.md), D1).
  - **Indicação e redes sociais:** link compartilhável para Instagram, WhatsApp e indicações.
  - **Google:** SEO na página e Perfil da Empresa no Google.
  - **Marketplaces de anúncio** (ex.: SalaJá, que diz não cobrar comissão), apontando para a página pública.

## 8. Fases propostas

**Fase 1 (MVP)**
- Página pública da sala.
- Cadastro de Profissional com aprovação.
- Disponibilidade, solicitação, aprovação e pagamento (Pix/cartão, avulso e pacote do mês).
- Reserva por hora, turno e dia; séries recorrentes.
- Bloqueios, horários, preços, limites e política de cancelamento parametrizáveis.
- Créditos, banco de horas, cancelamento e remarcação.
- Contrato e termo com aceite.
- Financeiro básico e envio manual do código de acesso.

**Fase 2**
- Cobrança recorrente no cartão e lembrete por recorrência.
- Código temporário automático na fechadura.
- Integração de agenda (Google Agenda ou iConsultório).
- Profissionais de confiança com aprovação automática.

## 9. Riscos

1. **Consentimento do proprietário** do imóvel para sublocar (a lei exige consentimento prévio e escrito). Verificar o contrato de locação e o regulamento do prédio. É o maior risco do projeto.
2. **Natureza do contrato:** uso por hora/turno costuma ser cessão de uso, não sublocação. Revisão por advogado.
3. **Licenças do consultório** (alvará, vigilância sanitária) para outros profissionais no mesmo espaço.
4. **Imposto de pessoa física** (carnê-leão), possível tarifação do Pix como uso comercial e tratamento do crédito vendido antes do uso (banco de horas) e do crédito vencido: alinhar com contador.
5. **LGPD:** CPF e registro profissional são dados pessoais.
6. **Demanda:** hoje há 2 interessadas.
7. **Concorrência:** levantada em [concorrentes.md](concorrentes.md). Existe software pronto para este caso (Sublocando, com plano gratuito); optamos por construir mesmo assim, pelas lacunas em [comparativo-sublocando.md](comparativo-sublocando.md). A concorrência pela clientela é local; o preço de mercado da hora para psicologia fica entre R$ 25 e R$ 55.

## 10. Decisões já tomadas

- Renda extra, uso próprio, uma sala.
- Construir sistema próprio em vez de usar o Sublocando.
- Preços iniciais: hora R$ 50, turno 1 R$ 200, turno 2 R$ 300, dia R$ 450.
- Pacote do mês da série com 10% de desconto.
- Banco de horas como crédito em reais com bônus, na mesma carteira dos cancelamentos, com validade.
- Público: psiquiatras, psicólogos e terapeutas.
- Reserva por hora, turno ou dia; recorrência já na fase 1.
- Antecedência de 24h a 60 dias; mínimo de 1h; grade em horas cheias.
- Trava de 1 hora cheia entre Profissionais diferentes, nos dois sentidos; o uso da esposa também gera trava.
- Turnos fixos: 07h–12h e 13h–22h.
- Aprovação manual; pagamento sempre antecipado.
- Série recorrente: o Profissional escolhe pacote do mês ou pagamento por ocorrência.
- Remarcação = cancelamento + nova reserva.
- Preços, horários, limites e regras de cancelamento parametrizáveis.
- Gateway Asaas, pessoa física.
- Cadastro com dados e registro profissional, conferência manual.
- Marca e domínio via Hub SaaS, em subdomínio.
- Captação: página pública, indicação/redes e Google.
- Agenda da esposa independente do iConsultório; dias bloqueados manualmente.
- Sem nota fiscal, caução ou taxa de cadastro.
- Cobrança recorrente no cartão fica para a fase 2.
- Decisões de jornada (D1 a D8: agenda só com login, prazos, série de 60 dias, notificação por e-mail, contas de Anfitrião, uso de crédito) em [jornadas-e-telas.md](jornadas-e-telas.md), seção 6.

## 11. Perguntas em aberto

Nenhuma bloqueia o desenho do MVP:

- **Hub SaaS:** nome do subdomínio e quando o domínio estará disponível.
- **Banco de horas:** faixas de pacote e bônus iniciais (ex.: R$ 450 → R$ 500; R$ 900 → R$ 1.050?).
- **Validade do crédito:** a mesma (90 dias) para crédito comprado e crédito de cancelamento?
- **Pendências externas** (não são de produto): contrato de locação, advogado, contador, escolha da fechadura, conta no Asaas.
