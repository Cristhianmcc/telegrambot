import { DateTime } from 'luxon';
import { ResolvedPeriod } from '../contracts/date.js';

const MONTH_NAMES_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

export function resolvePeriod(
  input: string,
  options: { timezone?: string; now?: Date } = {}
): ResolvedPeriod {
  const tz = options.timezone || 'America/Lima';
  const now = options.now
    ? DateTime.fromJSDate(options.now).setZone(tz)
    : DateTime.now().setZone(tz);

  const clean = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

  // 1. "hoy"
  if (clean === 'hoy') {
    const start = now.startOf('day');
    const end = start.plus({ days: 1 });
    const prevStart = start.minus({ days: 1 });
    return {
      kind: 'day',
      from: start.toJSDate(),
      to: end.toJSDate(),
      label: 'hoy',
      year: now.year,
      monthName: MONTH_NAMES_ES[now.month - 1],
      isPartial: true,
      previous: {
        from: prevStart.toJSDate(),
        to: start.toJSDate(),
        label: 'ayer',
        year: prevStart.year,
        monthName: MONTH_NAMES_ES[prevStart.month - 1]
      }
    };
  }

  // 2. "ayer"
  if (clean === 'ayer') {
    const start = now.minus({ days: 1 }).startOf('day');
    const end = start.plus({ days: 1 });
    const prevStart = start.minus({ days: 1 });
    return {
      kind: 'day',
      from: start.toJSDate(),
      to: end.toJSDate(),
      label: 'ayer',
      year: start.year,
      monthName: MONTH_NAMES_ES[start.month - 1],
      isPartial: false,
      previous: {
        from: prevStart.toJSDate(),
        to: start.toJSDate(),
        label: 'anteayer',
        year: prevStart.year,
        monthName: MONTH_NAMES_ES[prevStart.month - 1]
      }
    };
  }

  // 3. "esta semana"
  if (clean.includes('esta semana')) {
    const start = now.startOf('week'); // Lunes
    const end = now.endOf('day');
    const prevStart = start.minus({ weeks: 1 });
    const prevEnd = prevStart.plus({ days: now.weekday - 1 }).endOf('day');
    return {
      kind: 'week',
      from: start.toJSDate(),
      to: end.toJSDate(),
      label: 'esta semana',
      year: now.year,
      monthName: MONTH_NAMES_ES[now.month - 1],
      isPartial: true,
      previous: {
        from: prevStart.toJSDate(),
        to: prevEnd.toJSDate(),
        label: 'semana pasada (mismos días)',
        year: prevStart.year
      }
    };
  }

  // 4. "semana pasada"
  if (clean.includes('semana pasada')) {
    const start = now.minus({ weeks: 1 }).startOf('week');
    const end = start.plus({ weeks: 1 });
    const prevStart = start.minus({ weeks: 1 });
    return {
      kind: 'week',
      from: start.toJSDate(),
      to: end.toJSDate(),
      label: 'la semana pasada',
      year: start.year,
      monthName: MONTH_NAMES_ES[start.month - 1],
      isPartial: false,
      previous: {
        from: prevStart.toJSDate(),
        to: start.toJSDate(),
        label: 'hace 2 semanas',
        year: prevStart.year
      }
    };
  }

  // 5. "este mes" o default mensual
  if (clean.includes('este mes') || clean === '' || clean === 'mes') {
    const start = now.startOf('month');
    const end = start.plus({ months: 1 });
    const prevStart = start.minus({ months: 1 });
    const prevEnd = start;
    const currentMonthName = MONTH_NAMES_ES[now.month - 1];
    const prevMonthName = MONTH_NAMES_ES[prevStart.month - 1];

    return {
      kind: 'month',
      from: start.toJSDate(),
      to: end.toJSDate(),
      label: `${currentMonthName} ${now.year}`,
      monthName: currentMonthName,
      year: now.year,
      isPartial: true,
      previous: {
        from: prevStart.toJSDate(),
        to: prevEnd.toJSDate(),
        label: `${prevMonthName} ${prevStart.year}`,
        monthName: prevMonthName,
        year: prevStart.year
      }
    };
  }

  // 6. "mes pasado"
  if (clean.includes('mes pasado') || clean.includes('anterior')) {
    const start = now.minus({ months: 1 }).startOf('month');
    const end = start.plus({ months: 1 });
    const prevStart = start.minus({ months: 1 });
    const prevEnd = start;
    const monthName = MONTH_NAMES_ES[start.month - 1];
    const prevMonthName = MONTH_NAMES_ES[prevStart.month - 1];

    return {
      kind: 'month',
      from: start.toJSDate(),
      to: end.toJSDate(),
      label: `${monthName} ${start.year}`,
      monthName: monthName,
      year: start.year,
      isPartial: false,
      previous: {
        from: prevStart.toJSDate(),
        to: prevEnd.toJSDate(),
        label: `${prevMonthName} ${prevStart.year}`,
        monthName: prevMonthName,
        year: prevStart.year
      }
    };
  }

  // 7. Nombre de mes explícito (ej: "septiembre", "setiembre", "agosto", "octubre 2026")
  for (let i = 0; i < MONTH_NAMES_ES.length; i++) {
    const mName = MONTH_NAMES_ES[i];
    // soportar tanto setiembre como septiembre
    const matchFound =
      clean.includes(mName) ||
      (mName === 'septiembre' && clean.includes('setiembre'));

    if (matchFound) {
      // Extraer año si está en el texto (ej: 2025, 2026)
      const yearMatch = clean.match(/\b(202\d)\b/);
      let targetYear = yearMatch ? parseInt(yearMatch[1], 10) : now.year;

      const monthNum = i + 1; // 1-12
      // Si no especificó año y el mes seleccionado es futuro en el año actual, asumimos año anterior
      if (!yearMatch && monthNum > now.month) {
        targetYear = now.year - 1;
      }

      const start = DateTime.fromObject({ year: targetYear, month: monthNum, day: 1 }, { zone: tz }).startOf('month');
      const end = start.plus({ months: 1 });
      const prevStart = start.minus({ months: 1 });
      const prevEnd = start;
      const prevMonthName = MONTH_NAMES_ES[prevStart.month - 1];

      const isCurrentMonth = targetYear === now.year && monthNum === now.month;

      return {
        kind: 'month',
        from: start.toJSDate(),
        to: end.toJSDate(),
        label: `${mName} ${targetYear}`,
        monthName: mName,
        year: targetYear,
        isPartial: isCurrentMonth,
        previous: {
          from: prevStart.toJSDate(),
          to: prevEnd.toJSDate(),
          label: `${prevMonthName} ${prevStart.year}`,
          monthName: prevMonthName,
          year: prevStart.year
        }
      };
    }
  }

  // Fallback a "este mes"
  return resolvePeriod('este mes', options);
}
