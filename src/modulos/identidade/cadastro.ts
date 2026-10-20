import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@/db';
import { auth } from '@/lib/auth';
import { cpfValido, soDigitos } from '@/lib/cpf';
import { documentoVigente } from '@/modulos/configuracao/documentos-iniciais';
import { emailNovoCadastro } from '@/modulos/comunicacao/modelos';
import { anfitrioesAtivos, notificar } from '@/modulos/comunicacao/notificar';
import { registrarAuditoria } from '@/modulos/auditoria/auditoria';
import { PROFISSOES, UFS } from './opcoes';

const vazioParaUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

export const esquemaCadastro = z
  .object({
    nome: z.string().trim().min(5, 'Informe o nome completo.').max(120),
    email: z.string().trim().toLowerCase().email('E-mail inválido.').max(160),
    telefone: z
      .string()
      .transform(soDigitos)
      .refine((t) => t.length === 10 || t.length === 11, 'Informe o telefone com DDD.'),
    cpf: z.string().refine(cpfValido, 'CPF inválido.').transform(soDigitos),
    profissao: z.enum(['psiquiatra', 'psicologo', 'terapeuta', 'outro']),
    conselho: z.enum(['CRM', 'CRP', 'outro']),
    registroNumero: z.string().trim().min(2, 'Informe o número do registro.').max(20),
    registroUf: z.enum(UFS, { message: 'Escolha a UF do registro.' }),
    senha: z.string().min(10, 'A senha precisa ter ao menos 10 caracteres.').max(128),
    confirmarSenha: z.string(),
    aceiteContrato: z.preprocess(vazioParaUndefined, z.literal('on', { message: 'É preciso aceitar o contrato.' })),
  })
  .refine((v) => v.senha === v.confirmarSenha, { path: ['confirmarSenha'], message: 'As senhas não conferem.' });

export type DadosCadastro = z.infer<typeof esquemaCadastro>;

export type ContextoRequisicao = { ip: string | null; userAgent: string | null };

export type ResultadoCadastro =
  | { ok: true; profissionalId: string }
  | { ok: false; erro: 'cpf_em_uso' | 'email_em_uso' | 'sem_contrato' | 'falha' };

/**
 * Cria a conta (o Better Auth manda o e-mail de verificação), o cadastro profissional pendente
 * e o aceite do contrato, e avisa os Anfitriões. O Profissional já entra como `pendente` e pode
 * pedir reserva antes da aprovação (D2).
 */
export async function cadastrarProfissional(
  dados: DadosCadastro,
  contexto: ContextoRequisicao,
): Promise<ResultadoCadastro> {
  const contrato = await documentoVigente('contrato');
  if (!contrato) return { ok: false, erro: 'sem_contrato' };

  const [cpfExistente] = await db
    .select({ id: schema.profissional.usuarioId })
    .from(schema.profissional)
    .where(eq(schema.profissional.cpf, dados.cpf));
  if (cpfExistente) return { ok: false, erro: 'cpf_em_uso' };

  const [emailExistente] = await db
    .select({ id: schema.usuario.id })
    .from(schema.usuario)
    .where(eq(schema.usuario.email, dados.email));
  if (emailExistente) return { ok: false, erro: 'email_em_uso' };

  let usuarioId: string;
  try {
    const criado = await auth.api.signUpEmail({
      body: { email: dados.email, name: dados.nome, password: dados.senha, telefone: dados.telefone },
    });
    usuarioId = criado.user.id;
  } catch {
    return { ok: false, erro: 'falha' };
  }

  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.profissional).values({
        usuarioId,
        cpf: dados.cpf,
        profissao: dados.profissao,
        conselho: dados.conselho,
        registroNumero: dados.registroNumero,
        registroUf: dados.registroUf,
      });
      await tx.insert(schema.aceite).values({
        usuarioId,
        documentoId: contrato.id,
        ip: contexto.ip,
        userAgent: contexto.userAgent,
      });
    });
  } catch {
    // Não deixa conta sem cadastro profissional (por exemplo, se dois cadastros com o mesmo CPF
    // chegarem juntos e o banco recusar o segundo).
    await db.delete(schema.usuario).where(eq(schema.usuario.id, usuarioId));
    return { ok: false, erro: 'cpf_em_uso' };
  }

  await registrarAuditoria({
    usuarioId,
    acao: 'cadastro_profissional',
    entidade: 'profissional',
    entidadeId: usuarioId,
    ip: contexto.ip,
  });

  const modelo = emailNovoCadastro({
    nome: dados.nome,
    profissao: PROFISSOES[dados.profissao],
    conselho: dados.conselho,
    registro: dados.registroNumero,
    uf: dados.registroUf,
  });
  for (const a of await anfitrioesAtivos()) {
    await notificar({
      usuarioId: a.id,
      para: a.email,
      tipo: 'novo_cadastro',
      assunto: modelo.assunto,
      html: modelo.html,
      referenciaTipo: 'profissional',
      referenciaId: usuarioId,
    });
  }

  return { ok: true, profissionalId: usuarioId };
}
