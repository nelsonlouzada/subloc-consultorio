/** 15000 -> 'R$ 150,00'. Todo dinheiro do sistema é guardado em centavos, em inteiros. */
export function formatarReais(centavos: number): string {
  // O Intl separa "R$" do número com um espaço sem quebra (U+00A0); trocamos por espaço comum.
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
}
