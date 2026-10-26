import { describe, expect, it } from 'vitest';
import { ANO_MAXIMO, ANO_MINIMO, dataISOValida, instanteLocal, parseDataISO, partesLocais } from './fuso';

describe('fuso da sala', () => {
  it('07h local é 10h UTC', () => {
    expect(instanteLocal(2026, 10, 19, 7).toISOString()).toBe('2026-10-19T10:00:00.000Z');
  });

  it('22h local cai no dia seguinte em UTC, mas continua no mesmo dia local', () => {
    const t = instanteLocal(2026, 10, 19, 22);
    expect(t.toISOString()).toBe('2026-10-20T01:00:00.000Z');
    expect(partesLocais(t)).toMatchObject({ dia: 19, hora: 22, diaSemana: 1 });
  });

  it('meia-noite local não escorrega para o dia anterior', () => {
    const t = instanteLocal(2026, 10, 20, 0);
    expect(partesLocais(t)).toMatchObject({ dia: 20, hora: 0 });
  });

  it('domingo é 7', () => {
    expect(partesLocais(instanteLocal(2026, 10, 18, 12)).diaSemana).toBe(7);
  });
});

describe('parseDataISO', () => {
  it('aceita datas que existem, inclusive 29/02 de ano bissexto', () => {
    expect(parseDataISO('2026-10-26')).toEqual({ ano: 2026, mes: 10, dia: 26 });
    expect(parseDataISO('2028-02-29')).toEqual({ ano: 2028, mes: 2, dia: 29 });
    expect(parseDataISO(`${ANO_MINIMO}-01-01`).ano).toBe(2000);
    expect(parseDataISO(`${ANO_MAXIMO}-12-31`).ano).toBe(2100);
  });

  it.each([
    '9999-99-99', // o caso que derrubava três telas com erro 500
    '2026-02-31',
    '2026-02-29', // 2026 não é bissexto
    '2026-13-01',
    '2026-00-10',
    '2026-04-31',
    '2026-10-00',
    '2026-10-32',
    '1999-12-31',
    '2101-01-01',
    '0000-01-01',
    '2026-1-5',
    '26-10-2026',
    '2026-10-26T10:00',
    '',
    'lixo',
    "2026-10-26'; drop table usuario;--",
  ])('recusa %j', (texto) => {
    expect(() => parseDataISO(texto)).toThrow();
    expect(dataISOValida(texto)).toBe(false);
  });

  it('dataISOValida diz sim só para o que parseDataISO aceita', () => {
    expect(dataISOValida('2026-10-26')).toBe(true);
    expect(dataISOValida('2026-02-30')).toBe(false);
  });
});

