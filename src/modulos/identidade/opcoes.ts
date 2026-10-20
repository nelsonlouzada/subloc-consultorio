// Listas usadas no cadastro, na validação e nas telas. Arquivo sem dependências do servidor,
// para poder ser importado também por componentes do navegador.

export const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const;

export const PROFISSOES = {
  psiquiatra: 'Psiquiatra',
  psicologo: 'Psicólogo(a)',
  terapeuta: 'Terapeuta',
  outro: 'Outro',
} as const;

export const CONSELHOS = { CRM: 'CRM', CRP: 'CRP', outro: 'Outro conselho' } as const;

/** Conselho mais provável para cada profissão (o usuário pode trocar). */
export const CONSELHO_PADRAO = {
  psiquiatra: 'CRM',
  psicologo: 'CRP',
  terapeuta: 'outro',
  outro: 'outro',
} as const;

export const STATUS_PROFISSIONAL = {
  pendente: 'Pendente',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
  bloqueado: 'Bloqueado',
} as const;
