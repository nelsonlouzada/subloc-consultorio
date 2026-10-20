/** 15000 -> 'R$ 150,00'. Todo dinheiro do sistema é guardado em centavos, em inteiros. */
export function formatarReais(centavos: number): string {
  // O Intl separa "R$" do número com um espaço sem quebra (U+00A0); trocamos por espaço comum.
  return (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
}

/**
 * '50' -> 5000, '50,5' -> 5050, '1.234,56' -> 123456, 'R$ 80' -> 8000. Texto fora do formato
 * (negativo, letras, mais de 2 casas) devolve null, nunca um valor adivinhado.
 */
export function reaisParaCentavos(texto: string): number | null {
  let t = texto.replace(/R\$|\s| /g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return null;
  const [inteiro, frac = ''] = t.split('.');
  return Number(inteiro) * 100 + Number(frac.padEnd(2, '0'));
}
