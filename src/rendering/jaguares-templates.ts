import { InlineKeyboard } from 'grammy';
import {
  JagOverview,
  JagStudentCounts,
  JagIncomeSummary,
  JagDebtSummary,
  JagPendingDebtor,
  JagCapacity,
  JagEnrollments,
  JagRecentStudent,
  JagStudentDetail,
  JagVoucherDetail
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
  text += `• Total confirmado: <b>${formatSoles(data.totalConfirmed)}</b>\n`;
  text += `• Pagos recibidos: <b>${data.paymentsCount}</b>\n`;

  if (data.previousPeriod) {
    const diff = data.totalConfirmed - data.previousPeriod.totalConfirmed;
    const sign = diff >= 0 ? '+' : '';
    const pct = data.previousPeriod.changePct !== null ? ` (${sign}${data.previousPeriod.changePct}%)` : '';
    text += `• Comparado con ${escapeHtml(data.previousPeriod.periodLabel)}: <b>${sign}${formatSoles(diff)}</b>${pct}\n`;
  }

  if (data.byMethod.length > 0) {
    text += `\n💳 <b>Por método de pago:</b>\n`;
    for (const m of data.byMethod) {
      text += `• ${escapeHtml(m.method)}: <b>${formatSoles(m.amount)}</b> (${m.count} pagos)\n`;
    }
  }

  return text;
}

export function renderDebtSummary(data: JagDebtSummary): string {
  let text = `📋 <b>Cobranzas y Deudas · ${escapeHtml(data.month)} ${data.year}</b>\n\n`;
  text += `• <b>Deuda total pendiente:</b> <b>${formatSoles(data.totalDebtAmount)}</b>\n`;
  text += `• Alumnos con saldo pendiente: <b>${data.totalDebtors}</b>\n\n`;
  text += `• <b>Comprobantes por revisar:</b> ${data.pendingReviewCount} (${formatSoles(data.pendingReviewAmount)})\n`;
  text += `• <b>Sin comprobante / sin pago:</b> ${data.unpaidCount} (${formatSoles(data.unpaidAmount)})\n\n`;
  text += `<i>💡 Usa /deudores para ver el detalle de alumnos con saldo pendiente.</i>`;
  return text;
}

export function renderPendingDebtors(debtors: JagPendingDebtor[], monthLabel: string = 'este mes'): string {
  if (debtors.length === 0) {
    return `✅ <b>¡Excelente! No hay alumnos con mensualidades pendientes en ${escapeHtml(monthLabel)}.</b>`;
  }

  let text = `⏳ <b>Alumnos con Pago Pendiente · ${escapeHtml(monthLabel)}</b>\n\n`;
  let idx = 1;
  for (const d of debtors) {
    const statusIcon = d.status === 'pendiente_revision' ? '🟡' : '🔴';
    const statusText =
      d.status === 'pendiente_revision'
        ? '⏳ Comprobante por verificar'
        : '❌ Sin comprobante';

    text += `${idx}. ${statusIcon} <b>${escapeHtml(d.nombreCompleto)}</b> (DNI: <code>${escapeHtml(d.dni)}</code>)\n`;
    text += `   ↳ Monto: <b>${formatSoles(d.monto)}</b> | ${statusText}\n`;
    if (d.telefonoApoderado) {
      text += `   ↳ Apoderado: <code>${escapeHtml(d.telefonoApoderado)}</code>\n`;
    }
    idx++;
  }

  text += `\n<i>Descarga la lista completa en Excel con /excel.</i>`;
  return text;
}

export function renderCapacity(data: JagCapacity): string {
  let text = `🏟️ <b>Cupos y Horarios en Jaguares</b>\n\n`;

  if (data.items.length === 0) {
    return `<i>No se encontraron horarios activos para la disciplina consultada.</i>`;
  }

  for (const item of data.items) {
    const pct = item.occupancyPct;
    const icon = pct >= 90 ? '🔴' : pct >= 70 ? '🟡' : '🟢';
    text += `${icon} <b>${escapeHtml(item.discipline)}</b>\n`;
    text += `• Capacidad total: ${item.totalCapacity} cupos\n`;
    text += `• Ocupados: <b>${item.occupiedCapacity}</b> (${pct}%)\n`;
    text += `• Disponibles: <b>${item.availableCapacity}</b>\n\n`;
  }

  return text;
}

export function renderEnrollments(data: JagEnrollments): string {
  let text = `📋 <b>Matrículas e Inscripciones · ${escapeHtml(data.periodLabel)}</b>\n\n`;
  text += `• Alumnos nuevos matriculados: <b>${data.newStudentsCount}</b>\n`;
  text += `• Total inscripciones procesadas: <b>${data.totalEnrollmentsCount}</b>\n\n`;

  if (data.byDiscipline.length > 0) {
    text += `🏅 <b>Por disciplina:</b>\n`;
    for (const d of data.byDiscipline) {
      text += `• ${escapeHtml(d.discipline)}: <b>${d.count}</b> inscripciones\n`;
    }
  }

  return text;
}

export function renderRecentStudents(students: JagRecentStudent[]): string {
  if (students.length === 0) {
    return `ℹ️ No se registraron alumnos recientemente.`;
  }

  let text = `🆕 <b>Últimos Alumnos Matriculados</b>\n\n`;
  let idx = 1;
  for (const s of students) {
    text += `${idx}. 👤 <b>${escapeHtml(s.nombreCompleto)}</b>\n`;
    text += `   ↳ Deporte: <b>${escapeHtml(s.deporte)}</b>\n`;
    text += `   ↳ Fecha: <i>${s.fechaInscripcion}</i>\n`;
    idx++;
  }

  return text;
}

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

/**
 * Genera el enlace directo a WhatsApp para contactar o cobrar al apoderado.
 */
export function buildWhatsAppLink(
  rawPhone: string | undefined,
  studentName: string,
  parentName?: string,
  debtAmount?: number,
  monthName?: string
): string | null {
  if (!rawPhone) return null;
  const digits = rawPhone.replace(/\D/g, '');
  if (!digits || digits.length < 9) return null;

  let phone = digits;
  if (digits.length === 9 && digits.startsWith('9')) {
    phone = `51${digits}`;
  } else if (digits.length === 11 && digits.startsWith('519')) {
    phone = digits;
  }

  let text = '';
  if (debtAmount && debtAmount > 0) {
    const apoderadoSaludo = parentName ? `Estimado(a) ${parentName}` : 'Estimado(a) padre de familia';
    const mesTexto = monthName ? ` de ${monthName}` : '';
    text = `Hola ${apoderadoSaludo}, le saludamos de la Escuela Deportiva Jaguares 🐆.\n\nLe recordamos cordialmente que la mensualidad${mesTexto} de su menor hijo(a) *${studentName}* por *S/ ${debtAmount.toFixed(2)}* se encuentra pendiente.\n\nPuede regularizar mediante Yape, Plin o Transferencia y enviarnos su comprobante por este medio. ¡Muchas gracias por su puntualidad y apoyo! ⚽`;
  } else {
    const apoderadoSaludo = parentName ? `Estimado(a) ${parentName}` : 'Estimado(a) padre de familia';
    text = `Hola ${apoderadoSaludo}, le saludamos de la Escuela Deportiva Jaguares 🐆 respecto a su menor hijo(a) *${studentName}*.\n\n¿En qué podemos apoyarle hoy?`;
  }

  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

/**
 * Renderiza la ficha técnica completa de un alumno con botón directo a WhatsApp.
 */
export function renderStudentDetail(s: JagStudentDetail): { text: string; keyboard: InlineKeyboard } {
  let text = `👤 <b>Ficha de Alumno · Escuela Jaguares</b>\n\n`;
  text += `🎓 <b>Nombre:</b> ${escapeHtml(s.nombreCompleto)}\n`;
  text += `🆔 <b>DNI:</b> <code>${escapeHtml(s.dni)}</code>\n`;
  if (s.edad !== undefined) {
    text += `🎂 <b>Edad:</b> ${s.edad} años`;
    if (s.fechaNacimiento) text += ` <i>(Nac: ${s.fechaNacimiento})</i>`;
    text += `\n`;
  }
  text += `📌 <b>Estado:</b> <b>${escapeHtml(s.estadoAlumno.toUpperCase())}</b>\n\n`;

  if (s.disciplinas.length > 0) {
    text += `⚽ <b>Disciplinas y Horarios:</b>\n`;
    for (const d of s.disciplinas) {
      const scheduleInfo = d.dia ? `(${d.dia}${d.horario ? ` ${d.horario}` : ''})` : '';
      text += `• <b>${escapeHtml(d.deporte)}</b> ${scheduleInfo} · ${formatSoles(d.precioMensual)}/mes\n`;
    }
    text += `\n`;
  } else {
    text += `⚽ <b>Disciplinas:</b> Sin inscripciones activas\n\n`;
  }

  text += `💳 <b>Estado de Cobranza:</b>\n`;
  if (s.deuda.tieneDeuda) {
    text += `🚨 <b>Pendiente de pago:</b> <b>${formatSoles(s.deuda.totalDeuda)}</b>\n`;
    for (const p of s.deuda.mesesPendientes) {
      text += `   ↳ ${escapeHtml(p.mes)} ${p.anio}: ${formatSoles(p.monto)}\n`;
    }
  } else {
    text += `✅ <b>Al día</b> (sin mensualidades pendientes registradas)\n`;
  }
  text += `\n`;

  if (s.apoderado || s.telefonoApoderado) {
    text += `👨‍👩‍👧 <b>Apoderado:</b> ${escapeHtml(s.apoderado || 'No registrado')}\n`;
    text += `📞 <b>Teléfono:</b> <code>${escapeHtml(s.telefonoApoderado || 'No registrado')}</code>\n`;
  }

  const kb = new InlineKeyboard();

  const waCobranzaUrl = buildWhatsAppLink(
    s.telefonoApoderado,
    s.nombreCompleto,
    s.apoderado,
    s.deuda.tieneDeuda ? s.deuda.totalDeuda : undefined,
    s.deuda.mesesPendientes[0]?.mes
  );

  if (waCobranzaUrl) {
    const waButtonText = s.deuda.tieneDeuda ? '💬 Cobrar por WhatsApp' : '💬 Escribir por WhatsApp';
    kb.url(waButtonText, waCobranzaUrl).row();
  }

  const voucherUrl = s.deuda.mesesPendientes.find((m) => m.comprobanteUrl)?.comprobanteUrl;
  if (voucherUrl) {
    kb.text('📸 Ver Voucher Subido', `voucher_view_${s.alumnoId}`).row();
  }

  kb.text('🔙 Volver al Menú', 'action_back_menu');

  return { text, keyboard: kb };
}

/**
 * Renderiza el detalle de un comprobante de pago subido.
 */
export function renderVoucherDetail(v: JagVoucherDetail): { text: string; keyboard: InlineKeyboard } {
  let text = `📸 <b>Comprobante de Pago Subido</b>\n\n`;
  text += `👤 <b>Alumno:</b> ${escapeHtml(v.alumnoNombre)} (DNI: <code>${escapeHtml(v.dni)}</code>)\n`;
  text += `💰 <b>Monto:</b> <b>${formatSoles(v.monto)}</b>\n`;
  if (v.mes && v.anio) {
    text += `📅 <b>Mes correspondiente:</b> ${escapeHtml(v.mes)} ${v.anio}\n`;
  }
  text += `💳 <b>Método:</b> ${escapeHtml(v.metodoPago || 'Yape / Plin')}\n`;
  if (v.numeroOperacion) {
    text += `🔢 <b>Nº Operación:</b> <code>${escapeHtml(v.numeroOperacion)}</code>\n`;
  }
  text += `📌 <b>Estado:</b> <b>${escapeHtml(v.estado.toUpperCase())}</b>\n`;
  if (v.fechaPago) {
    text += `🕒 <b>Fecha registrada:</b> ${v.fechaPago}\n`;
  }

  const kb = new InlineKeyboard();
  if (v.comprobanteUrl) {
    kb.url('🔗 Abrir Imagen en Navegador', v.comprobanteUrl).row();
  }

  const waUrl = buildWhatsAppLink(v.telefono, v.alumnoNombre);
  if (waUrl) {
    kb.url('💬 Contactar por WhatsApp', waUrl).row();
  }

  kb.text('🔙 Volver', 'action_back_menu');

  return { text, keyboard: kb };
}
