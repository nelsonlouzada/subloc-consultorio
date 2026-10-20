import { and, desc, eq } from 'drizzle-orm';
import { db, schema } from '@/db';

// TEXTOS PROVISÓRIOS. Rascunho para o uso real com as primeiras profissionais (E2).
// Precisam de revisão por advogado antes do lançamento público (E6), conforme o plano de
// entregas e a seção de riscos da visão. Nunca editar o texto de uma versão já publicada:
// publicar uma versão nova (o aceite guarda a versão exata que cada pessoa aceitou).

export const CONTRATO_V1 = `CONTRATO DE CESSÃO TEMPORÁRIA DE USO DE SALA (versão provisória 1)

Este texto é um rascunho provisório e ainda será revisado por advogado.

1. Objeto. O Anfitrião cede ao Profissional, de forma onerosa e temporária, o uso de uma sala de consultório, nos dias e horários reservados por meio deste sistema. A cessão vale apenas para o período de cada reserva confirmada e não cria vínculo de locação, sociedade ou emprego.

2. Finalidade. A sala só pode ser usada para atendimento em saúde mental (psiquiatria, psicologia e terapias), por profissional habilitado e com registro ativo no respectivo conselho. O Profissional declara que os dados de registro informados no cadastro são verdadeiros e se compromete a mantê-los atualizados.

3. Reservas e acesso. As reservas seguem as regras do sistema (horários de funcionamento, antecedência, intervalo de uma hora entre profissionais diferentes e aprovação pelo Anfitrião). O código de acesso é pessoal e intransferível, e só vale para o período reservado.

4. Preço e pagamento. O valor de cada reserva é o informado no sistema no momento do pedido, e o pagamento é sempre antecipado. A reserva só é confirmada após o pagamento.

5. Cancelamento. Vale a política de cancelamento informada no sistema no momento da reserva. Devoluções são feitas, em regra, em crédito na plataforma.

6. Cuidado com o espaço. O Profissional deixa a sala limpa, organizada e como a encontrou, respeita o horário de saída e responde por danos que causar ao espaço, aos móveis e aos equipamentos.

7. Sigilo e documentos. O sigilo profissional e a guarda dos prontuários e demais documentos dos pacientes são de responsabilidade exclusiva do Profissional. Nenhum documento ou dado de paciente deve ser deixado na sala.

8. Responsabilidade. O Profissional responde civil e eticamente por seus atendimentos e por quaisquer danos a terceiros decorrentes deles. Recomenda-se a contratação de seguro de responsabilidade profissional.

9. Dados pessoais. Os dados do cadastro (nome, CPF, contato e registro profissional) são tratados apenas para gerir reservas, pagamentos e a comunicação entre as partes, conforme a Lei Geral de Proteção de Dados (LGPD).

10. Vigência e encerramento. Este contrato vale por prazo indeterminado e pode ser encerrado por qualquer das partes, sem prejuízo das reservas já confirmadas. O Anfitrião pode bloquear o acesso do Profissional em caso de descumprimento.

11. Aceite. Ao concluir o cadastro, o Profissional declara ter lido e aceitado este contrato. Ficam registrados a data, a hora, o IP e a versão do texto aceito.`;

export const TERMO_RESERVA_V1 = `TERMO DE RESERVA (versão provisória 1)

Este texto é um rascunho provisório e ainda será revisado por advogado.

Ao enviar este pedido, declaro que:
- o horário pedido só fica garantido depois de aprovado pelo Anfitrião e pago dentro do prazo informado; se o prazo vencer, o horário é liberado;
- entre dois profissionais diferentes há sempre uma hora livre de intervalo;
- o pagamento é antecipado, e o cancelamento segue a política mostrada antes de eu confirmar, com devolução em crédito;
- o código de acesso é pessoal, vale só para este horário e não pode ser repassado;
- vou deixar a sala limpa e organizada, respeitar o horário de saída e responder por danos que eu causar;
- sou responsável pelo sigilo e pelos documentos dos meus pacientes e não deixarei nada na sala;
- li e aceito o contrato aceito no meu cadastro.`;

/** Publica a versão 1 de cada documento, se ainda não existir. Pode rodar quantas vezes quiser. */
export async function garantirDocumentosIniciais(): Promise<{ criados: string[] }> {
  const criados: string[] = [];
  for (const [tipo, texto] of [
    ['contrato', CONTRATO_V1],
    ['termo_reserva', TERMO_RESERVA_V1],
  ] as const) {
    const [existente] = await db
      .select({ id: schema.documentoLegal.id })
      .from(schema.documentoLegal)
      .where(and(eq(schema.documentoLegal.tipo, tipo), eq(schema.documentoLegal.versao, 1)));
    if (existente) continue;
    await db.insert(schema.documentoLegal).values({ tipo, versao: 1, texto });
    criados.push(tipo);
  }
  return { criados };
}

/** O documento mais recente de cada tipo, que é o que a pessoa aceita agora. */
export async function documentoVigente(tipo: 'contrato' | 'termo_reserva') {
  const [d] = await db
    .select()
    .from(schema.documentoLegal)
    .where(eq(schema.documentoLegal.tipo, tipo))
    .orderBy(desc(schema.documentoLegal.versao))
    .limit(1);
  return d ?? null;
}
