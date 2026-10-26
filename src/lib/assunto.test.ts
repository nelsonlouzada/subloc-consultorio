import { describe, expect, it } from 'vitest';
import { assuntoSeguro } from './assunto';

describe('assuntoSeguro', () => {
  it('deixa passar o texto normal, com acentos e símbolos', () => {
    expect(assuntoSeguro('Sua reserva foi aprovada: falta o pagamento')).toBe('Sua reserva foi aprovada: falta o pagamento');
    expect(assuntoSeguro('Pedido de R$ 50,00 – João & Maria (5 > 3)')).toBe('Pedido de R$ 50,00 – João & Maria (5 3)');
  });

  it.each([
    ['<script>alert(1)</script> Ana', 'alert(1) Ana'],
    ['Olá <img src=x onerror=alert(1)> Ana', 'Olá Ana'],
    ['linha 1\nlinha 2\r\nlinha 3', 'linha 1 linha 2 linha 3'],
    ['com' + String.fromCharCode(0) + 'controle' + String.fromCharCode(7) + 'aqui', 'com controle aqui'],
    ['sobra de < marcação', 'sobra de marcação'],
    ['separadores' + String.fromCharCode(0x2028) + 'unicode' + String.fromCharCode(0x2029) + 'aqui', 'separadores unicode aqui'],
    ['  muitos   espaços  ', 'muitos espaços'],
  ])('sanea %j', (entrada, esperado) => {
    expect(assuntoSeguro(entrada)).toBe(esperado);
  });

  it('limita o tamanho', () => {
    const r = assuntoSeguro('a'.repeat(500));
    expect(r.length).toBe(150);
    expect(r.endsWith('…')).toBe(true);
    expect(assuntoSeguro('b'.repeat(50), 10)).toHaveLength(10);
  });
});
