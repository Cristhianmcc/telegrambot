import { describe, it, expect } from 'vitest';
import { resolvePeriod } from '../src/date-resolver/date-resolver.js';

describe('DateResolver', () => {
  // Fijamos una fecha de prueba: 4 de Octubre de 2026, 10:00 AM Lima
  const fixedNow = new Date('2026-10-04T15:00:00.000Z');

  it('resuelve "hoy"', () => {
    const period = resolvePeriod('hoy', { now: fixedNow });
    expect(period.kind).toBe('day');
    expect(period.label).toBe('hoy');
    expect(period.monthName).toBe('octubre');
    expect(period.year).toBe(2026);
    expect(period.isPartial).toBe(true);
    expect(period.previous?.label).toBe('ayer');
  });

  it('resuelve "ayer"', () => {
    const period = resolvePeriod('ayer', { now: fixedNow });
    expect(period.kind).toBe('day');
    expect(period.label).toBe('ayer');
    expect(period.year).toBe(2026);
  });

  it('resuelve "este mes"', () => {
    const period = resolvePeriod('este mes', { now: fixedNow });
    expect(period.kind).toBe('month');
    expect(period.monthName).toBe('octubre');
    expect(period.year).toBe(2026);
    expect(period.isPartial).toBe(true);
    expect(period.previous?.monthName).toBe('septiembre');
  });

  it('resuelve "mes pasado"', () => {
    const period = resolvePeriod('mes pasado', { now: fixedNow });
    expect(period.kind).toBe('month');
    expect(period.monthName).toBe('septiembre');
    expect(period.year).toBe(2026);
    expect(period.isPartial).toBe(false);
  });

  it('resuelve "septiembre"', () => {
    const period = resolvePeriod('septiembre', { now: fixedNow });
    expect(period.monthName).toBe('septiembre');
    expect(period.year).toBe(2026);
    expect(period.previous?.monthName).toBe('agosto');
  });

  it('resuelve "setiembre" (variante peruana común)', () => {
    const period = resolvePeriod('setiembre', { now: fixedNow });
    expect(period.monthName).toBe('septiembre');
    expect(period.year).toBe(2026);
  });

  it('resuelve mes con año explícito "agosto 2025"', () => {
    const period = resolvePeriod('agosto 2025', { now: fixedNow });
    expect(period.monthName).toBe('agosto');
    expect(period.year).toBe(2025);
  });
});
