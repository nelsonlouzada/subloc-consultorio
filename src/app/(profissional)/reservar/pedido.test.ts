import { describe, expect, it } from 'vitest';
import { dataValida } from './pedido';

describe('dataValida (data vinda da URL)', () => {
  it('devolve a data quando ela existe', () => {
    expect(dataValida('2026-11-03')).toEqual({ ano: 2026, mes: 11, dia: 3 });
  });

  it.each(['9999-99-99', '2026-02-31', '0000-01-01', '2026-13-45', 'lixo', '', undefined])('devolve null para %j, em vez de deixar a página quebrar', (texto) => {
    expect(dataValida(texto)).toBeNull();
  });
});
