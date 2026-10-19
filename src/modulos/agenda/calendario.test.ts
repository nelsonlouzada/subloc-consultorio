import { describe, expect, it } from 'vitest';
import { formatarDataISO, instanteLocal } from '@/lib/fuso';
import { diasDaSemana, horaTexto, limitesDoDia, segundaDaSemana, semanasDoMes } from './calendario';

const iso = formatarDataISO;

describe('calendário', () => {
  it('a semana começa na segunda e termina no domingo', () => {
    // 2026-11-04 é quarta-feira
    const dias = diasDaSemana({ ano: 2026, mes: 11, dia: 4 }).map(iso);
    expect(dias[0]).toBe('2026-11-02');
    expect(dias[6]).toBe('2026-11-08');
  });

  it('domingo pertence à semana que termina nele', () => {
    expect(iso(segundaDaSemana({ ano: 2026, mes: 11, dia: 8 }))).toBe('2026-11-02');
  });

  it('a semana atravessa a virada de mês e de ano', () => {
    const dias = diasDaSemana({ ano: 2026, mes: 12, dia: 31 }).map(iso);
    expect(dias[0]).toBe('2026-12-28');
    expect(dias[6]).toBe('2027-01-03');
  });

  it('o mês vira semanas completas, com dias vizinhos nas pontas', () => {
    const semanas = semanasDoMes(2026, 11); // 01/11 é domingo
    expect(semanas.every((s) => s.length === 7)).toBe(true);
    expect(iso(semanas[0][0])).toBe('2026-10-26');
    expect(iso(semanas[semanas.length - 1][6])).toBe('2026-12-06');
  });

  it('o dia local vai de 00h a 00h do dia seguinte (UTC-3)', () => {
    const [ini, fim] = limitesDoDia({ ano: 2026, mes: 11, dia: 2 });
    expect(ini.toISOString()).toBe('2026-11-02T03:00:00.000Z');
    expect(fim.toISOString()).toBe('2026-11-03T03:00:00.000Z');
  });

  it('hora em texto usa a hora local da sala', () => {
    expect(horaTexto(instanteLocal(2026, 11, 2, 7, 30))).toBe('07:30');
    expect(horaTexto(new Date('2026-11-03T01:00:00Z'))).toBe('22:00'); // 22h do dia 02 em Brasília
  });
});
