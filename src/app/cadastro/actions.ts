'use server';

import { contextoRequisicao } from '@/lib/sessao';
import { cadastrarProfissional, esquemaCadastro } from '@/modulos/identidade/cadastro';

export type EstadoCadastro = {
  ok?: boolean;
  /** Erro geral (não ligado a um campo). */
  erro?: string;
  /** Mensagem por campo. */
  campos?: Record<string, string>;
  /** Valores digitados, para repovoar o formulário (nunca as senhas). */
  valores?: Record<string, string>;
};

const SENSIVEIS = ['senha', 'confirmarSenha'];

export async function cadastrarAction(_anterior: EstadoCadastro, formData: FormData): Promise<EstadoCadastro> {
  const bruto = Object.fromEntries([...formData.entries()].filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  const valores = Object.fromEntries(Object.entries(bruto).filter(([k]) => !SENSIVEIS.includes(k)));

  const lido = esquemaCadastro.safeParse(bruto);
  if (!lido.success) {
    const campos: Record<string, string> = {};
    for (const i of lido.error.issues) {
      const campo = String(i.path[0] ?? '');
      if (campo && !campos[campo]) campos[campo] = i.message;
    }
    return { campos, valores };
  }

  const r = await cadastrarProfissional(lido.data, await contextoRequisicao());
  if (r.ok) return { ok: true };

  switch (r.erro) {
    case 'cpf_em_uso':
      return { campos: { cpf: 'Já existe um cadastro com este CPF.' }, valores };
    case 'email_em_uso':
      return { campos: { email: 'Este e-mail já tem cadastro. Entre ou recupere a senha.' }, valores };
    default:
      return { erro: 'Não foi possível concluir o cadastro agora. Tente de novo em instantes.', valores };
  }
}
