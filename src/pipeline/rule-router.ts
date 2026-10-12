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
  | 'jag.birthdays'
  | 'jag.dropout_risk'
  | 'jag.ranking'
  | 'jag.docentes_control'
  | 'jag.operation_search'
  | 'jag.asistencias_dni'
  | 'jag.discrepancies'
  | 'jag.today_schedule'
  | 'jag.capacity_alerts'
  | 'jag.monthly_comparison'
  | 'jag.payment_methods'
  | 'jag.whatsapp_templates'
  | 'jag.system_health'
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
    birthdayPeriod?: 'hoy' | 'semana' | 'mes';
    rankingFilter?: 'top' | 'perfect';
    targetFecha?: string;
    operationNumber?: string;
    dni?: string;
  };
}

function cleanText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s/]/g, ' ')
    .replace(/\s+/g, ' ')
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
    text === '/resumen' ||
    /^(?:ver\s+)?resumen(?:\s+general)?$/i.test(text)
  ) {
    const period = resolvePeriod('este mes', options);
    return {
      intent: 'jag.overview',
      confidence: 0.98,
      slots: { period, rawText }
    };
  }

  // 3. Deudores específicos / "¿Quiénes deben?" (con tolerancia a faltas tipográficas)
  if (
    /(?:quienes?\s+deben?|lista.*deudor|alumnos?\s+que\s+deben?|que\s+alumnos?\s+deben?|quien.*debe|morosos?)/i.test(text) ||
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
    /(?:cuanto\s+(?:nos\s+)?deben|cuanto\s+falta(?:\s+por)?\s+cobr|cuanto\s+se\s+debe|deudas?|pagos?\s+pendientes?|falta\s+por\s+cobrar)/i.test(text) ||
    text === '/deudas'
  ) {
    const period = resolvePeriod(rawText, options);
    return {
      intent: 'jag.debt_summary',
      confidence: 0.95,
      slots: { period, rawText }
    };
  }

  // 4b. Desglose de ingresos por método de pago (Yape, Plin, Transferencia) (0 tokens)
  if (
    /(?:metodos?\s+de\s+pago|formas?\s+de\s+pago|desglose\s+(?:de\s+)?pagos?|yape\s+vs\s+plin|yape\s+o\s+plin|ingresos?\s+por\s+metodo|^\/metodos?$|^\/metodos_pago$)/i.test(text) ||
    /(?:cuanto|ingresos?).*(?:yape|plin)/i.test(text)
  ) {
    return {
      intent: 'jag.payment_methods',
      confidence: 0.98,
      slots: { rawText }
    };
  }

  // 5. Ingresos / Cobros / "¿Cuánto hemos cobrado?" (con tolerancia a faltas tipográficas: cobramo, ingres, etc.)
  if (
    /(?:cuanto\s+(?:hemos\s+)?cobr|cuanto\s+ingres|ingresos?|total\s+cobr|recaudad|cuanto\s+se\s+cobr)/i.test(text)
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
    /(?:cupos?|capacidad|ocupacion|horarios?\s+disponibles?|vacantes?)/i.test(text)
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
    /(?:cuantos?\s+alumnos?|total\s+de\s+alumnos?|alumnos?\s+activos?|alumnos?\s+por\s+disciplina|alumnos?\s+tiene|alumnos?\s+hay|^alumnos?$)/i.test(text)
  ) {
    const discipline = extractDiscipline(rawText);
    return {
      intent: 'jag.student_counts',
      confidence: 0.95,
      slots: { discipline, rawText }
    };
  }

  // 9. Cumpleaños de alumnos (0 tokens)
  if (
    /(?:cumplean|cumpleanero|quien.*cumple|quienes.*cumplen|^\/cumpleanos?$|^\/cumple$)/i.test(text)
  ) {
    let birthdayPeriod: 'hoy' | 'semana' | 'mes' = 'hoy';
    if (text.includes('semana')) birthdayPeriod = 'semana';
    else if (text.includes('mes')) birthdayPeriod = 'mes';
    return {
      intent: 'jag.birthdays',
      confidence: 0.98,
      slots: { birthdayPeriod, rawText }
    };
  }

  // 10. Alerta de deserción / Faltas críticas (0 tokens)
  if (
    /(?:desercion|alumnos?\s+en\s+riesgo|riesgo.*desercion|muchas?\s+faltas?|faltas?\s+consecutivas?|quienes?\s+faltan\s+mucho|inasistencias?\s+criticas?|^\/desercion$|^\/faltas?$)/i.test(text)
  ) {
    return {
      intent: 'jag.dropout_risk',
      confidence: 0.98,
      slots: { rawText }
    };
  }

  // 11. Ranking y Alumnos destacados (0 tokens)
  if (
    /(?:ranking|top\s+alumnos?|mejores?\s+alumnos?|alumnos?\s+destacados?|asistencia\s+perfecta|100%\s+asistencia|^\/ranking$)/i.test(text)
  ) {
    const rankingFilter = (text.includes('perfect') || text.includes('100')) ? 'perfect' : 'top';
    return {
      intent: 'jag.ranking',
      confidence: 0.98,
      slots: { rankingFilter, rawText }
    };
  }

  // 12. Control de docentes / Quién pasó lista (0 tokens)
  if (
    /(?:pasaron\s+lista|paso\s+lista|pasaron\s+asistencia|paso\s+asistencia|control\s+de\s+docentes?|control\s+docentes?|control\s+profesores?|^\/docentes?$|^\/profesores?$)/i.test(text)
  ) {
    let targetFecha: string | undefined = undefined;
    if (text.includes('ayer')) {
      const target = options.now ? new Date(options.now.getTime() - 86400000) : new Date(Date.now() - 86400000);
      targetFecha = target.toISOString().split('T')[0];
    } else if (text.includes('hoy')) {
      const target = options.now || new Date();
      targetFecha = target.toISOString().split('T')[0];
    }
    return {
      intent: 'jag.docentes_control',
      confidence: 0.98,
      slots: { targetFecha, rawText }
    };
  }

  // 13. Búsqueda de operación bancaria (0 tokens)
  const opMatch = rawText.match(/(?:operaci[oó]n|numop|voucher_op|nro\s*op|n[uú]mero\s*de\s*operaci[oó]n)\s*[:#]?\s*([a-zA-Z0-9_-]{4,25})/i);
  if (opMatch && opMatch[1]) {
    return {
      intent: 'jag.operation_search',
      confidence: 0.98,
      slots: { operationNumber: opMatch[1].trim(), rawText }
    };
  }

  // 14. Asistencias de alumno por DNI (0 tokens)
  const dniMatch = rawText.match(/(?:asistencias?|asistencia del alumno|asistencias de)\s+(\d{8})\b/i);
  if (dniMatch && dniMatch[1]) {
    return {
      intent: 'jag.asistencias_dni',
      confidence: 0.98,
      slots: { dni: dniMatch[1], rawText }
    };
  }

  // 15. Auditoría de inconsistencias: Puerta (QR) vs Docente (0 tokens)
  if (
    /(?:discrepancias?|inconsistencias?|puerta\s+(?:vs|versus)\s+(?:docente|profesor)|diferencias?\s+(?:de\s+)?asistencias?|^\/discrepancias?$)/i.test(text)
  ) {
    let targetFecha: string | undefined = undefined;
    if (text.includes('ayer')) {
      const target = options.now ? new Date(options.now.getTime() - 86400000) : new Date(Date.now() - 86400000);
      targetFecha = target.toISOString().split('T')[0];
    } else if (text.includes('hoy')) {
      const target = options.now || new Date();
      targetFecha = target.toISOString().split('T')[0];
    }
    return {
      intent: 'jag.discrepancies',
      confidence: 0.98,
      slots: { targetFecha, rawText }
    };
  }

  // 16. Agenda de clases de hoy en tiempo real (0 tokens)
  if (
    /(?:clases\s+de\s+hoy|horarios?\s+de\s+hoy|que\s+clases\s+hay\s+hoy|agenda\s+(?:de\s+)?hoy|turnos?\s+de\s+hoy|^\/hoy$|^\/agenda$)/i.test(text)
  ) {
    return {
      intent: 'jag.today_schedule',
      confidence: 0.98,
      slots: { rawText }
    };
  }

  // 17. Alertas de aforo y cupos críticos (0 tokens)
  if (
    /(?:aforo\s+critico|alertas?\s+de\s+aforo|horarios?\s+llenos?|cupos?\s+llenos?|saturaci[oó]n|^\/aforo$|^\/alertas_aforo$)/i.test(text) ||
    text === 'aforo'
  ) {
    return {
      intent: 'jag.capacity_alerts',
      confidence: 0.98,
      slots: { rawText }
    };
  }

  // 18. Comparativa mes a mes MoM (0 tokens)
  if (
    /(?:comparativa|comparaci[oó]n|mes\s+a\s+mes|crecimiento\s+(?:mensual|mom)|respecto\s+al\s+mes\s+anterior|^\/comparativa$|^\/mom$|^\/crecimiento$)/i.test(text)
  ) {
    return {
      intent: 'jag.monthly_comparison',
      confidence: 0.98,
      slots: { rawText }
    };
  }

  // 20. Plantillas preformateadas de WhatsApp (0 tokens)
  if (
    /(?:plantillas?|mensajes?).*(?:whatsapp|cobranza|bienvenida)|^\/plantillas?$|^\/templates?$/i.test(text) ||
    text === 'plantillas'
  ) {
    return {
      intent: 'jag.whatsapp_templates',
      confidence: 0.98,
      slots: { rawText }
    };
  }

  // 21. Diagnóstico y salud del sistema / MySQL ping (0 tokens)
  if (
    /(?:estado\s+del\s+sistema|salud\s+del\s+sistema|diagnostico|estado\s+del\s+servidor|ping\s+mysql|latencia\s+mysql|^\/sistema$|^\/salud$|^\/diagnostico$|^\/ping$)/i.test(text) ||
    text === 'sistema' ||
    text === 'salud'
  ) {
    return {
      intent: 'jag.system_health',
      confidence: 0.98,
      slots: { rawText }
    };
  }

  // Si no coincide con ninguna regla determinista
  return null;
}
