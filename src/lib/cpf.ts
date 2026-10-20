/** Mantém só os dígitos. */
export const soDigitos = (texto: string) => texto.replace(/\D/g, '');

/** Valida os dois dígitos verificadores do CPF (não consulta a Receita). */
export function cpfValido(texto: string): boolean {
  const cpf = soDigitos(texto);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // 111.111.111-11 passa na conta, mas não existe

  const digito = (base: string) => {
    const soma = [...base].reduce((s, d, i) => s + Number(d) * (base.length + 1 - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(cpf.slice(0, 9)) === Number(cpf[9]) && digito(cpf.slice(0, 10)) === Number(cpf[10]);
}

/** 12345678909 -> 123.456.789-09 */
export function formatarCpf(texto: string): string {
  const c = soDigitos(texto);
  return c.length === 11 ? `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}` : texto;
}
