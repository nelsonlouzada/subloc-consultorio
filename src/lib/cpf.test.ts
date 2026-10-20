import { describe, expect, it } from 'vitest';
import { cpfValido, formatarCpf, soDigitos } from './cpf';

describe('CPF', () => {
  it('aceita CPFs válidos, com ou sem pontuação', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('52998224725')).toBe(true);
    expect(cpfValido('111.444.777-35')).toBe(true);
  });

  it('recusa dígito verificador errado', () => {
    expect(cpfValido('529.982.247-24')).toBe(false);
    expect(cpfValido('529.982.247-35')).toBe(false);
  });

  it('recusa sequências repetidas, que passam na conta mas não existem', () => {
    expect(cpfValido('111.111.111-11')).toBe(false);
    expect(cpfValido('00000000000')).toBe(false);
  });

  it('recusa tamanho errado e texto', () => {
    expect(cpfValido('1234567890')).toBe(false);
    expect(cpfValido('123456789012')).toBe(false);
    expect(cpfValido('abc')).toBe(false);
    expect(cpfValido('')).toBe(false);
  });

  it('formata e limpa', () => {
    expect(formatarCpf('52998224725')).toBe('529.982.247-25');
    expect(soDigitos('529.982.247-25')).toBe('52998224725');
  });
});
