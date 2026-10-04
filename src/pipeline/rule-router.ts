import { resolvePeriod } from '../date-resolver/date-resolver.js';
import { ResolvedPeriod } from '../contracts/date.js';

export type JaguaresIntent =
  | 'jag.overview'
  | 'jag.student_counts'
  | 'jag.income_summary'
  | 'jag.debt_summary'
  | 'jag.pending_payments'
  | 'jag.enrollments'
  | 'jag.recent_students'
  | 'jag.capacity'
  | 'general.help'
  | 'general.menu'
  | 'general.greeting'
  | 'general.direct_response';

export interface RouteMatch {
  intent: JaguaresIntent;
  confidence: number;
  slots: {
    period?: ResolvedPeriod;
    discipline?: string;
    rawText: string;
    directResponse?: string;
  };
}

function cleanText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

const DISCIPLINES = ['futbol', 'voley', 'voleibol', 'basquet', 'baloncesto', 'karate', 'natacion', 'gimnasia'];

function extractDiscipline(text: string): string | undefined {
  const norm = cleanText(text);
  for (const d of DISCIPLINES) {
    if (norm.includes(d)) {
      if (d === 'futbol') return 'Fútbol';
      if (d === 'voley' || d === 'voleibol') return 'Vóley';
      if (d === 'basquet' || d === 'baloncesto') return 'Básquet';
      return d.charAt(0).toUpperCase() + d.slice(1);
    }
  }
  return undefined;
}

export function routeMessage(rawText: string, options: { now?: Date; timezone?: string } = {}): RouteMatch | null {
  const text = cleanText(rawText);

  // 0. Saludos comunes
  if (
    text === 'hola' ||
    text === 'buenas' ||
    text === 'buen dia' ||
    text === 'buenos dias' ||
    text === 'buenas tardes' ||
    text === 'buenas noches' ||
    text === 'que tal' ||
    text === 'hola bot' ||
    text === 'saludos' ||
    text.startsWith('hola ')
  ) {
    return {
      intent: 'general.greeting',
      confidence: 1.0,
      slots: { rawText }
    };
  }

  // 1. Ayuda o Comandos
  if (text === 'ayuda' || text === '/ayuda' || text === '/help') {
    return {
      intent: 'general.help',
      confidence: 1.0,
      slots: { rawText }
    };
  }

  if (text === 'menu' || text === '/menu' || text === 'opciones') {
    return {
      intent: 'general.menu',
      confidence: 1.0,
      slots: { rawText }
    };
  }

  // 2. Resumen general / "¿Cómo está la escuela?"
  if (
    text.includes('como esta la escuela') ||
    text.includes('como va la escuela') ||
    text === 'resumen' ||
    text === 'resumen general' ||
    text === 'estado de la escuela' ||
    text === '/resumen'
  ) {
    const period = resolvePeriod('este mes', options);
    return {
      intent: 'jag.overview',
      confidence: 0.98,
      slots: { period, rawText }
    };
  }

  // 3. Deudores específicos / "¿Quiénes deben?"
  if (
    text.includes('quienes deben') ||
    text.includes('lista de deudores') ||
    text.includes('alumnos que deben') ||
    text.includes('que alumnos deben') ||
    text.includes('quien debe') ||
    text === '/deudores'
  ) {
    const period = resolvePeriod(rawText, options);
    return {
      intent: 'jag.pending_payments',
      confidence: 0.95,
      slots: { period, rawText }
    };
  }

  // 4. Deudas y cobranzas totales / "¿Cuánto nos deben?"
  if (
    text.includes('cuanto nos deben') ||
    text.includes('cuanto falta cobrar') ||
    text.includes('cuanto se debe') ||
    text.includes('deudas') ||
    text.includes('pagos pendientes') ||
    text.includes('falta por cobrar') ||
    text === '/deudas'
  ) {
    const period = resolvePeriod(rawText, options);
    return {
      intent: 'jag.debt_summary',
      confidence: 0.95,
      slots: { period, rawText }
    };
  }

  // 5. Ingresos / Cobros / "¿Cuánto hemos cobrado?"
  if (
    text.includes('cuanto hemos cobrado') ||
    text.includes('cuanto cobramos') ||
    text.includes('cuanto ingres') ||
    text.includes('ingresos') ||
    text.includes('total cobrado') ||
    text.includes('recaudado')
  ) {
    const period = resolvePeriod(rawText, options);
    return {
      intent: 'jag.income_summary',
      confidence: 0.95,
      slots: { period, rawText }
    };
  }

  // 6a. Alumno más nuevo / últimos alumnos inscritos
  if (
    text.includes('mas nuevo') ||
    text.includes('mas reciente') ||
    text.includes('ultimo alumno') ||
    text.includes('ultimos alumnos') ||
    text.includes('ultimos inscritos') ||
    text.includes('quien es el nuevo') ||
    text.includes('quien fue el ultimo')
  ) {
    return {
      intent: 'jag.recent_students',
      confidence: 0.98,
      slots: { rawText }
    };
  }

  // 6b. Conteo de nuevos alumnos / Nuevas matrículas
  if (
    text.includes('nuevos alumnos') ||
    text.includes('alumnos nuevos') ||
    text.includes('ingresaron este mes') ||
    text.includes('matriculas nuevas') ||
    text.includes('nuevas matriculas') ||
    text.includes('cuantos ingresaron')
  ) {
    const period = resolvePeriod(rawText, options);
    return {
      intent: 'jag.enrollments',
      confidence: 0.95,
      slots: { period, rawText }
    };
  }

  // 7. Capacidad / Cupos / Ocupación
  if (
    text.includes('cupo') ||
    text.includes('capacidad') ||
    text.includes('ocupacion') ||
    text.includes('horarios disponibles')
  ) {
    const discipline = extractDiscipline(rawText);
    return {
      intent: 'jag.capacity',
      confidence: 0.92,
      slots: { discipline, rawText }
    };
  }

  // 8. Conteo de alumnos / Por disciplina
  if (
    text.includes('cuantos alumnos') ||
    text.includes('total de alumnos') ||
    text.includes('alumnos activos') ||
    text.includes('alumnos por disciplina') ||
    text.includes('alumnos tiene') ||
    text.includes('alumnos hay') ||
    text === 'alumnos'
  ) {
    const discipline = extractDiscipline(rawText);
    return {
      intent: 'jag.student_counts',
      confidence: 0.95,
      slots: { discipline, rawText }
    };
  }

  // Si no coincide con ninguna regla determinista
  return null;
}
