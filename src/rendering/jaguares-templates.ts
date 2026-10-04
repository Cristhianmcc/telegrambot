import {
  JagOverview,
  JagStudentCounts,
  JagIncomeSummary,
  JagDebtSummary,
  JagPendingDebtor,
  JagCapacity,
  JagEnrollments,
  JagRecentStudent
} from '../contracts/jaguares.js';

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function formatSoles(amount: number): string {
  return `S/ ${amount.toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

export function renderOverview(data: JagOverview, monthLabel: string = 'este mes'): string {
  let text = `🎓 <b>Jaguares · Resumen de ${escapeHtml(monthLabel)}</b>\n\n`;
  text += `👥 Alumnos activos: <b>${data.activeStudents}</b>\n`;
  text += `✨ Nuevos ${escapeHtml(monthLabel)}: <b>${data.newStudentsThisMonth}</b>\n`;
  text += `💰 Ingresos confirmados: <b>${formatSoles(data.incomeThisMonth)}</b>\n`;
  text += `⏳ Pendiente de cobro: <b>${formatSoles(data.pendingDebtAmount)}</b> (${data.pendingDebtCount} alumnos)\n`;

  if (data.topDiscipline) {
    text += `\n⚽ Disciplina con más alumnos:\n`;
    text += `<b>${escapeHtml(data.topDiscipline.name)}</b> — ${data.topDiscipline.studentCount} alumnos\n`;
  }

  return text;
}

export function renderStudentCounts(data: JagStudentCounts, filter?: string): string {
  let text = `👥 <b>Alumnos en Jaguares</b>\n\n`;
  text += `• Total registrados: <b>${data.totalStudents}</b>\n`;
  text += `• Alumnos activos: <b>${data.activeStudents}</b>\n`;
  text += `• Inactivos / no matriculados: <b>${data.inactiveStudents}</b>\n\n`;

  if (data.byDiscipline.length > 0) {
    text += `🏅 <b>Por disciplina${filter ? ` (${escapeHtml(filter)})` : ''}:</b>\n`;
    for (const d of data.byDiscipline) {
      text += `• ${escapeHtml(d.discipline)}: <b>${d.count}</b> alumnos\n`;
    }
  } else if (filter) {
    text += `<i>No se encontraron alumnos en la disciplina "${escapeHtml(filter)}".</i>\n`;
  }

  return text;
}

export function renderIncomeSummary(data: JagIncomeSummary): string {
  let text = `💰 <b>Ingresos · ${escapeHtml(data.periodLabel)}</b>\n\n`;
  text += `Total confirmado: <b>${formatSoles(data.totalConfirmed)}</b>\n`;
  text += `Pagos confirmados: <b>${data.paymentsCount}</b>\n`;

  if (data.previousPeriod) {
    text += `\nComparado con ${escapeHtml(data.previousPeriod.periodLabel)}: `;
    if (data.previousPeriod.changePct !== null) {
      const arrow = data.previousPeriod.changePct >= 0 ? '↑' : '↓';
      text += `<b>${arrow} ${Math.abs(data.previousPeriod.changePct)}%</b> (previo: ${formatSoles(data.previousPeriod.totalConfirmed)})\n`;
    } else {
      text += `(previo: ${formatSoles(data.previousPeriod.totalConfirmed)})\n`;
    }
  }

  if (data.byMethod.length > 0) {
    text += `\n💳 <b>Por método de pago:</b>\n`;
    for (const m of data.byMethod) {
      text += `• ${escapeHtml(m.method)}: <b>${formatSoles(m.amount)}</b> (${m.count})\n`;
    }
  }

  return text;
}

export function renderDebtSummary(data: JagDebtSummary): string {
  let text = `📋 <b>Cobranzas y Deudas · ${escapeHtml(data.month)} ${data.year}</b>\n\n`;
  text += `Total pendiente: <b>${formatSoles(data.totalDebtAmount)}</b>\n`;
  text += `Alumnos con saldo pendiente: <b>${data.totalDebtors}</b>\n\n`;

  text += `• <b>Comprobantes por revisar:</b> ${data.pendingReviewCount} (${formatSoles(data.pendingReviewAmount)})\n`;
  text += `• <b>Sin comprobante / sin pago:</b> ${data.unpaidCount} (${formatSoles(data.unpaidAmount)})\n\n`;

  text += `💡 <i>Escribe "quiénes deben" para ver la lista de alumnos.</i>`;

  return text;
}

export function renderPendingDebtors(debtors: JagPendingDebtor[], month: string): string {
  if (debtors.length === 0) {
    return `✅ <b>¡Excelente!</b> No hay alumnos con pagos pendientes para <b>${escapeHtml(month)}</b>.`;
  }

  let text = `📋 <b>Alumnos con Pagos Pendientes (${escapeHtml(month)})</b>\n\n`;

  debtors.forEach((d, idx) => {
    const statusLabel =
      d.status === 'pendiente_revision'
        ? '⏳ Comprobante por verificar'
        : '❌ Sin pago';
    text += `${idx + 1}. <b>${escapeHtml(d.nombreCompleto)}</b>\n`;
    text += `   DNI: ${d.dni} — Monto: <b>${formatSoles(d.monto)}</b>\n`;
    text += `   Estado: <i>${statusLabel}</i>`;
    if (d.telefonoApoderado) {
      text += ` | 📞 ${escapeHtml(d.telefonoApoderado)}`;
    }
    text += `\n\n`;
  });

  return text;
}

export function renderCapacity(data: JagCapacity): string {
  let text = `🏟️ <b>Ocupación de Horarios · Jaguares</b>\n\n`;

  if (data.items.length === 0) {
    return text + `<i>No se encontraron horarios activos.</i>`;
  }

  for (const item of data.items) {
    text += `<b>${escapeHtml(item.discipline)}</b>\n`;
    text += `• Ocupados: <b>${item.occupiedCapacity}</b> de <b>${item.totalCapacity}</b> cupos (${item.occupancyPct}%)\n`;
    text += `• Disponibles: <b>${item.availableCapacity}</b>\n\n`;
  }

  return text;
}

export function renderEnrollments(data: JagEnrollments): string {
  let text = `✨ <b>Matrículas · ${escapeHtml(data.periodLabel)}</b>\n\n`;
  text += `• Nuevos alumnos únicos: <b>${data.newStudentsCount}</b>\n`;
  text += `• Total inscripciones realizadas: <b>${data.totalEnrollmentsCount}</b>\n\n`;

  if (data.byDiscipline.length > 0) {
    text += `🏅 <b>Por disciplina:</b>\n`;
    for (const d of data.byDiscipline) {
      text += `• ${escapeHtml(d.discipline)}: <b>${d.count}</b>\n`;
    }
  }

  return text;
}

export function renderRecentStudents(students: JagRecentStudent[]): string {
  if (students.length === 0) {
    return `ℹ️ <i>No se encontraron inscripciones registradas.</i>`;
  }

  let text = `✨ <b>Alumnos Más Recientes Inscritos</b>\n\n`;
  students.forEach((s, idx) => {
    text += `${idx + 1}. <b>${escapeHtml(s.nombreCompleto)}</b>\n`;
    text += `   🏅 Disciplina: <b>${escapeHtml(s.deporte)}</b>\n`;
    text += `   📅 Fecha: <i>${escapeHtml(s.fechaInscripcion)}</i>\n\n`;
  });

  return text;
}

/**
 * Convierte de forma segura texto en formato Markdown (generado por el LLM)
 * a HTML nativo soportado por Telegram Bot API.
 */
export function markdownToTelegramHtml(markdown: string): string {
  if (!markdown) return '';

  let text = markdown;

  // 1. Reemplazar bloques de código ```...```
  text = text.replace(/```(?:[a-zA-Z]*)\n?([\s\S]*?)```/g, '<pre>$1</pre>');

  // 2. Reemplazar código inline `...`
  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // 3. Reemplazar negritas **texto** o __texto__ por <b>texto</b>
  text = text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
  text = text.replace(/__(.*?)__/g, '<b>$1</b>');

  // 4. Reemplazar cursivas simples *texto* o _texto_
  text = text.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '<i>$1</i>');
  text = text.replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '<i>$1</i>');

  // 5. Normalizar listas con guión o asterisco al inicio de línea
  text = text.replace(/^[ \t]*[-*]\s+/gm, '• ');

  // 6. Normalizar saltos de línea excesivos
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}
