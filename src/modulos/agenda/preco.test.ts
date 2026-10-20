import { describe, expect, it } from 'vitest';
import { instanteLocal } from '@/lib/fuso';
import { calcularPreco, PedidoInvalidoError, type TabelaPrecos } from './preco';

// Valores iniciais da visão: hora R$ 50, turno 1 R$ 200, turno 2 R$ 300, dia R$ 450.
const tabela: TabelaPrecos = {
  horaCentavos: 5000,
  diaCentavos: 45000,
  turnos: [
    { id: 't1', nome: 'Turno 1', inicio: 7, fim: 12, centavos: 20000 },
    { id: 't2', nome: 'Turno 2', inicio: 13, fim: 22, centavos: 30000 },
  ],
};

const preco = (de: number, ate: number, t = tabela) =>
  calcularPreco(instanteLocal(2026, 11, 2, de), instanteLocal(2026, 11, 2, ate), t).valorCentavos / 100;

describe('menor preço possível (tabela do modelo de dados)', () => {
  it.each([
    [9, 12, 150], // turno 1: min(3 x 50, 200)
    [8, 12, 200], // turno 1: min(4 x 50, 200)
    [7, 12, 200], // turno 1 inteiro
    [9, 14, 250], // 150 + hora 12h-13h (50) + 50
    [13, 22, 300], // turno 2 inteiro
    [7, 22, 450], // dia: min(200 + 50 + 300, 450)
  ])('%ih às %ih custa R$ %i', (de, ate, esperado) => {
    expect(preco(de, ate)).toBe(esperado);
  });

  it.each([
    [7, 8, 50], // uma hora avulsa
    [12, 13, 50], // a hora entre os turnos custa a hora avulsa
    [13, 15, 100],
    [15, 22, 300], // 7 horas: min(350, 300)
    [7, 13, 250], // turno 1 + hora do meio
    [8, 22, 450], // 200 + 50 + 300 = 550, o dia (450) é menor
    [10, 22, 450], // 100 + 50 + 300 = 450, empata com o dia
    [9, 21, 450], // 150 + 50 + 300 = 500, o dia (450) é menor
  ])('%ih às %ih custa R$ %i', (de, ate, esperado) => {
    expect(preco(de, ate)).toBe(esperado);
  });

  it('nunca cobra mais por pedir mais horas (a partir das 7h, o preço não diminui ao esticar o fim)', () => {
    let anterior = 0;
    for (let fim = 8; fim <= 22; fim++) {
      const p = preco(7, fim);
      expect(p).toBeGreaterThanOrEqual(anterior);
      anterior = p;
    }
  });

  it('quatro horas avulsas igualam o turno 1 e seis igualam o turno 2 (visão, 4.2)', () => {
    expect(4 * 50).toBe(200);
    expect(6 * 50).toBe(300);
    expect(preco(8, 12)).toBe(200);
    expect(preco(16, 22)).toBe(300);
  });

  it('o dia inteiro custa menos que os dois turnos somados', () => {
    expect(preco(7, 22)).toBeLessThan(preco(7, 12) + preco(13, 22));
  });
});

describe('detalhe do cálculo (mostrado no resumo do pedido)', () => {
  it('9h às 14h separa turnos e a hora do meio', () => {
    const r = calcularPreco(instanteLocal(2026, 11, 2, 9), instanteLocal(2026, 11, 2, 14), tabela);
    expect(r.horas).toBe(5);
    expect(r.detalhe.porTurno).toEqual([
      { turnoId: 't1', nome: 'Turno 1', horas: 3, centavos: 15000 },
      { turnoId: 't2', nome: 'Turno 2', horas: 1, centavos: 5000 },
    ]);
    expect(r.detalhe.foraDeTurno).toEqual({ horas: 1, centavos: 5000 });
    expect(r.detalhe.somaCentavos).toBe(25000);
    expect(r.detalhe.usouDia).toBe(false);
  });

  it('marca quando o dia inteiro foi o menor preço', () => {
    const r = calcularPreco(instanteLocal(2026, 11, 2, 7), instanteLocal(2026, 11, 2, 22), tabela);
    expect(r.detalhe.somaCentavos).toBe(55000);
    expect(r.detalhe.usouDia).toBe(true);
    expect(r.valorCentavos).toBe(45000);
  });
});

describe('preços alterados pelo Anfitrião', () => {
  it('usa a tabela recebida, sem valores fixos no cálculo', () => {
    const outra: TabelaPrecos = { ...tabela, horaCentavos: 4000, diaCentavos: 40000 };
    expect(preco(9, 10, outra)).toBe(40);
    expect(preco(7, 22, outra)).toBe(400);
  });
});

describe('pedidos inválidos', () => {
  it('rejeita fim antes do início', () => {
    expect(() => preco(10, 9)).toThrow(PedidoInvalidoError);
  });

  it('rejeita horas quebradas (a grade é em horas cheias)', () => {
    expect(() =>
      calcularPreco(instanteLocal(2026, 11, 2, 9, 30), instanteLocal(2026, 11, 2, 11, 30), tabela),
    ).toThrow(PedidoInvalidoError);
    expect(() =>
      calcularPreco(instanteLocal(2026, 11, 2, 9), instanteLocal(2026, 11, 2, 10, 30), tabela),
    ).toThrow(PedidoInvalidoError);
  });

  it('rejeita reserva que atravessa a meia-noite', () => {
    expect(() =>
      calcularPreco(instanteLocal(2026, 11, 2, 20), instanteLocal(2026, 11, 3, 2), tabela),
    ).toThrow(PedidoInvalidoError);
  });

  it('aceita terminar exatamente à meia-noite (24h)', () => {
    expect(() => calcularPreco(instanteLocal(2026, 11, 2, 22), instanteLocal(2026, 11, 3, 0), tabela)).not.toThrow();
  });
});
