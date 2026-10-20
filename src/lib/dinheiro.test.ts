import { describe, expect, it } from 'vitest';
import { formatarReais } from './dinheiro';

describe('formatarReais', () => {
  it('formata centavos em reais', () => {
    expect(formatarReais(15000)).toBe('R$ 150,00');
    expect(formatarReais(5000)).toBe('R$ 50,00');
    expect(formatarReais(45050)).toBe('R$ 450,50');
    expect(formatarReais(0)).toBe('R$ 0,00');
    expect(formatarReais(123456789)).toBe('R$ 1.234.567,89');
  });
});
