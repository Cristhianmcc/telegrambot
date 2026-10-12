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

  it('reconoce cumpleaños sin gastar tokens -> jag.birthdays', () => {
    const m1 = routeMessage('¿Quién cumple años hoy?');
    expect(m1?.intent).toBe('jag.birthdays');
    expect(m1?.slots.birthdayPeriod).toBe('hoy');

    const m2 = routeMessage('cumpleaños de esta semana');
    expect(m2?.intent).toBe('jag.birthdays');
    expect(m2?.slots.birthdayPeriod).toBe('semana');
  });

  it('reconoce alerta de deserción sin tokens -> jag.dropout_risk', () => {
    const match = routeMessage('alumnos en riesgo de desercion');
    expect(match?.intent).toBe('jag.dropout_risk');
  });

  it('reconoce ranking y asistencia perfecta -> jag.ranking', () => {
    const m1 = routeMessage('ranking de alumnos');
    expect(m1?.intent).toBe('jag.ranking');
    expect(m1?.slots.rankingFilter).toBe('top');

    const m2 = routeMessage('alumnos con asistencia perfecta');
    expect(m2?.intent).toBe('jag.ranking');
    expect(m2?.slots.rankingFilter).toBe('perfect');
  });

  it('reconoce búsqueda de operación bancaria -> jag.operation_search', () => {
    const match = routeMessage('verificar operacion 987654');
    expect(match?.intent).toBe('jag.operation_search');
    expect(match?.slots.operationNumber).toBe('987654');
  });

  it('reconoce consulta de asistencias por DNI -> jag.asistencias_dni', () => {
    const match = routeMessage('asistencias 72819203');
    expect(match?.intent).toBe('jag.asistencias_dni');
    expect(match?.slots.dni).toBe('72819203');
  });

  it('soporta errores tipográficos leves (fuzzy matching) sin gastar tokens', () => {
    // "cuanto cobramo" sin 's'
    const m1 = routeMessage('cuanto cobramo este mes');
    expect(m1?.intent).toBe('jag.income_summary');

    // "cuanto ingres"
    const m2 = routeMessage('cuanto ingres hoy');
    expect(m2?.intent).toBe('jag.income_summary');

    // "quien debe" en singular
    const m3 = routeMessage('quien debe este mes');
    expect(m3?.intent).toBe('jag.pending_payments');

    // "cupo" singular con puntuación
    const m4 = routeMessage('¿cupo en futbol?');
    expect(m4?.intent).toBe('jag.capacity');
  });
});
