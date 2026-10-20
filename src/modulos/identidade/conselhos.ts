// Onde o Anfitrião confere o registro (visao.md, seção 5). O CFM e o CFP não aceitam link direto
// para um número, então o link leva à página de consulta e o Anfitrião digita o número.
// Confirmar os endereços de tempos em tempos: os conselhos podem mudar os portais.
const LINKS: Record<string, string> = {
  CRM: 'https://portal.cfm.org.br/busca-medicos/',
  CRP: 'https://cadastro.cfp.org.br/',
};

export function linkConsultaConselho(conselho: string): string | null {
  return LINKS[conselho] ?? null;
}
