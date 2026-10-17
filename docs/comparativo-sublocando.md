# Comparativo: Sublocando × nossas regras (docs/visao.md v0.3)

Data: 2026-10-17 · Fonte: páginas públicas do Sublocando (página inicial, Para clínicas, Como funciona, Preços com FAQ, página de uma clínica e Termos de Serviço). **Não entrei no sistema**: o que só aparece depois do cadastro ficou marcado como "não visto".

Legenda: ✅ atende · ⚠️ atende em parte ou de outro jeito · ❌ não atende pelo que é público · ❓ não visto nas páginas públicas

## 1. Planos do Sublocando

| Plano | Preço | Limites e recursos |
|---|---|---|
| Gratuito | R$ 0 | 1 espaço, 2 salas, **até 60 agendamentos/mês**, relatórios básicos, suporte por e-mail |
| Básico | R$ 79/mês | 1 espaço, 4 salas, profissionais e agendamentos ilimitados, métricas, todos os relatórios, recibo digital |
| Profissional | R$ 179/mês | 3 espaços, **mensalidades e faturas automáticas**, **integração Mercado Pago e Inter**, recibo digital |
| Empresarial | sob consulta | API, múltiplas unidades, pagamentos personalizados |

Publicar as salas no marketplace deles é gratuito em qualquer plano. Plano anual dá 2 meses grátis.

## 2. Item a item

| # | Nossa regra | Sublocando | Nota |
|---|---|---|---|
| 1 | Uma sala, um Anfitrião | ✅ | Cabe no plano Gratuito (1 espaço, 2 salas). |
| 2 | Página pública da sala | ✅ | Página por clínica com fotos, descrição, salas, preço, WhatsApp e link para compartilhar. |
| 3 | Marca e domínio próprios (Hub SaaS) | ❌ | A página fica em sublocando.com.br, com a marca deles. |
| 4 | Captação: Google e marketplaces | ✅ | **Vantagem deles:** a sala entra no marketplace do Sublocando, que também recebe tráfego do Google. Hoje são cerca de 25 espaços em 13 cidades. |
| 5 | Cadastro do Profissional com aprovação | ⚠️ | "Solicitar acesso": nome, e-mail, WhatsApp, área de atuação e mensagem; a clínica aprova. Também há convite por código. **CPF e CRM/CRP não aparecem** no formulário. |
| 6 | Aprovação de **cada** reserva | ⚠️ | Pelo texto, a clínica aprova o **acesso** do Profissional uma vez e depois ele reserva direto. É o nosso "Profissional de confiança" da fase 2. Aprovação por reserva não vista. |
| 7 | Hora, turno e dia | ✅ | Por hora, por turno ("período") e mensal; um anúncio cita diária. |
| 8 | Preços parametrizáveis | ✅ | Por hora, turno ou mensal; valor por faixa de horário, por dia da semana e **negociado por Profissional**. Mais completo que o nosso. |
| 9 | Cobrar o menor preço possível | ❓ | |
| 10 | Antecedência mínima 24h e máxima 60 dias | ❓ | O FAQ fala em "personalização completa de regras de agendamento" sem detalhar. |
| 11 | Mínimo 1h, grade em horas cheias | ❓ | |
| 12 | Trava de 1 hora entre Profissionais, nos dois sentidos, livre para o mesmo Profissional | ⚠️ | Existe "intervalo entre agendamentos" configurável. Não deu para ver se aceita 60 min nem se isenta o mesmo Profissional. |
| 13 | Turnos fixos 07h–12h e 13h–22h | ❓ | Provável, por "horários específicos" e "valores por período". |
| 14 | Reserva recorrente | ✅ | Horário fixo semanal e quinzenal. |
| 15 | Série: Profissional escolhe pacote do mês ou por ocorrência | ⚠️ | Há mensalidades e faturas automáticas, mas **só no plano de R$ 179**. A escolha pelo Profissional não vista. |
| 16 | Pagamento **sempre antecipado**; reserva só confirma após pagar; link com prazo | ❌ | O modelo deles é de **cobrança e fatura**: lembrete de vencimento e relatório de inadimplência. Isso indica pagar depois de reservar. Nada indica que a reserva espera o pagamento. |
| 17 | Asaas, conta de pessoa física | ❌ | Integra Mercado Pago e Banco Inter (plano de R$ 179). Asaas não citado. |
| 18 | Pix **e cartão** | ⚠️ | O FAQ fala em cobrança **via Pix**. Cartão não citado. |
| 19 | Política de cancelamento parametrizável, com crédito | ⚠️ | A página da clínica diz "preço, cancelamento e recorrência definidos antes", então há alguma regra. Créditos não vistos. |
| 20 | Remarcação = cancela + nova reserva | ❓ | |
| 21 | Bloqueios: uso próprio (com trava) e indisponível (sem trava) | ❓ | Dá para cadastrar a esposa como Profissional para ocupar os horários dela. |
| 22 | Contrato no cadastro e termo aceito a cada reserva, com registro do aceite | ❌ | Não aparece. O FAQ trata contratos já existentes como algo fora da plataforma. |
| 23 | Código de acesso por reserva (fechadura) | ❌ | "Saiba quem entra" significa convites, permissões e histórico de uso, não fechadura. |
| 24 | Financeiro e relatórios | ✅ | Ocupação por sala e horário, receita, inadimplência, extrato por Profissional, exportação em PDF e Excel. |
| 25 | Recibo por reserva | ✅ | Recibo digital a partir do plano Básico (R$ 79). |
| 26 | Integração com Google Agenda (fase 2) | ❓ | |

## 3. Leitura

**O que o Sublocando já resolve bem:** agenda com recorrência, preços flexíveis, página pública, financeiro e relatórios. Ele ainda **traz Profissionais pelo marketplace dele**, algo que o nosso sistema não teria no início.

**Onde ele diverge das nossas decisões:**
1. **Pagar antes de confirmar** (❌): é a maior diferença. O modelo deles é cobrar e acompanhar a inadimplência.
2. **Asaas e cartão** (❌/⚠️): só Mercado Pago e Inter, e via Pix, no plano de R$ 179.
3. **Contrato e termo com aceite** (❌).
4. **Código da fechadura** (❌). Pode ser contornado: o app da própria fechadura gera o código e vocês enviam à mão.
5. **Marca própria** (❌).
6. **Aprovação por reserva** (⚠️): eles aprovam o Profissional, não cada reserva.

**Custo:** Gratuito até 60 agendamentos/mês. Pagamento integrado só no Profissional, por R$ 179/mês, o equivalente a cerca de 3,6 horas de sala a R$ 50/h.

## 4. Caminhos

- **A. Começar no Sublocando (Gratuito).** Põe a sala no ar em dias, sem desenvolvimento, e usa o marketplace deles para captar. Abre mão de pagamento antecipado (pelo que é público), Asaas, contrato com aceite e marca própria. Serve para validar a demanda e o preço enquanto os riscos jurídicos são checados. Construir o próprio depois, se as lacunas pesarem.
- **B. Construir o próprio.** Faz sentido se pagar antes de confirmar, contrato com aceite e marca própria forem inegociáveis, ou se a ideia é ter um produto no Hub SaaS. Custo: semanas de desenvolvimento antes da primeira reserva.
- **C. Híbrido.** Construir o próprio e, enquanto ele não fica pronto, operar no Sublocando. Atenção: as duas agendas não conversam, então o mesmo horário poderia ser vendido duas vezes. Só funciona se for um ou outro em cada período.

**Para tirar os ❓:** criar uma conta gratuita de clínica e testar, ou pedir a demonstração ("Falar com especialista"). Eu não posso criar contas; isso teria que ser feito por vocês.

## 5. Fontes

- [Sublocando — página inicial](https://sublocando.com.br/)
- [Para clínicas](https://sublocando.com.br/para-clinicas)
- [Como funciona](https://sublocando.com.br/como-funciona)
- [Preços e FAQ](https://sublocando.com.br/precos)
- [Exemplo de página de clínica](https://sublocando.com.br/clinicas/49fef7d2-62b2-45e1-92d9-62dbb38d77d3)
- [Termos de Serviço](https://sublocando.com.br/termos-de-servico)
