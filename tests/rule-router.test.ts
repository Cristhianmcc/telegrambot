import { describe, it, expect } from 'vitest';
import { routeMessage } from '../src/pipeline/rule-router.js';

describe('RuleRouter for Jaguares', () => {
  it('reconoce saludo "hola" -> general.greeting', () => {
    const match = routeMessage('hola');
    expect(match?.intent).toBe('general.greeting');
  });

  it('reconoce "¿Cómo está la escuela?" -> jag.overview', () => {
    const match = routeMessage('¿Cómo está la escuela?');
    expect(match?.intent).toBe('jag.overview');
  });

  it('reconoce "¿Cuántos alumnos tenemos?" -> jag.student_counts', () => {
    const match = routeMessage('¿Cuántos alumnos tenemos actualmente?');
    expect(match?.intent).toBe('jag.student_counts');
  });

  it('reconoce "¿Cuántos alumnos tiene fútbol?" -> jag.student_counts con discipline = Fútbol', () => {
    const match = routeMessage('¿Cuántos alumnos tiene fútbol?');
    expect(match?.intent).toBe('jag.student_counts');
    expect(match?.slots.discipline).toBe('Fútbol');
  });

  it('reconoce "¿Cuánto hemos cobrado este mes?" -> jag.income_summary', () => {
    const match = routeMessage('¿Cuánto hemos cobrado este mes?');
    expect(match?.intent).toBe('jag.income_summary');
    expect(match?.slots.period?.monthName).toBeDefined();
  });

  it('reconoce "¿Cuánto cobramos en septiembre?" -> jag.income_summary con período septiembre', () => {
    const match = routeMessage('¿Cuánto cobramos en septiembre?');
    expect(match?.intent).toBe('jag.income_summary');
    expect(match?.slots.period?.monthName).toBe('septiembre');
  });

  it('reconoce "¿Cuánto falta cobrar?" -> jag.debt_summary', () => {
    const match = routeMessage('¿Cuánto falta cobrar?');
    expect(match?.intent).toBe('jag.debt_summary');
  });

  it('reconoce "¿Quiénes deben?" -> jag.pending_payments', () => {
    const match = routeMessage('¿Quiénes deben este mes?');
    expect(match?.intent).toBe('jag.pending_payments');
  });

  it('reconoce "¿Cuántos alumnos nuevos ingresaron este mes?" -> jag.enrollments', () => {
    const match = routeMessage('¿Cuántos alumnos nuevos ingresaron este mes?');
    expect(match?.intent).toBe('jag.enrollments');
  });

  it('reconoce "¿Qué alumno es el más nuevo?" -> jag.recent_students', () => {
    const match = routeMessage('Que alumno es el más nuevo ?');
    expect(match?.intent).toBe('jag.recent_students');
  });

  it('reconoce cupos y capacidad -> jag.capacity', () => {
    const match = routeMessage('¿Cómo están los cupos de fútbol?');
    expect(match?.intent).toBe('jag.capacity');
    expect(match?.slots.discipline).toBe('Fútbol');
  });
});
