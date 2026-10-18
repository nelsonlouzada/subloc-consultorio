import { describe, expect, it } from 'vitest';
import { instanteLocal, partesLocais } from './fuso';

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
