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
  JagVoucherDetail,
  JagAsistenciasAlumno,
  JagDocentesControlResumen,
  JagDocenteAlumnosClase,
  JagBirthdayStudent,
  JagDropoutRiskStudent,
  JagOperationSearchResult,
  JagRankingStudent,
  JagAttendanceDiscrepancy,
  JagTodayScheduleItem,
  JagCapacityAlert,
  JagMonthlyComparison,
  JagPaymentMethodBreakdown,
  JagSystemHealth
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

/**
 * Renderiza el historial de asistencias de un alumno.
 * Muestra AMBAS fuentes: asistencia del docente (presente) y asistencia de puerta.
 *
 * Casos por registro:
 *   presente=1 & puerta=1 → ✅ Docente + 🚦 Puerta
 *   presente=1 & puerta=0 → ✅ Docente · sin registro puerta
 *   presente=0 & puerta=1 → 🚦 Puerta · ❌ Ausente (docente)
 *   presente=0 & puerta=0 → ❌ Ausente
 */
export function renderAsistenciasAlumno(
  data: JagAsistenciasAlumno,
  page: number = 0
): { text: string; keyboard: InlineKeyboard } {
  const nombreCompleto = `${data.alumno.nombres} ${data.alumno.apellido_paterno} ${data.alumno.apellido_materno}`.trim();

  // Paginación: 10 registros por página
  const PAGE_SIZE = 10;
  const totalPages = Math.max(1, Math.ceil(data.asistencias.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = data.asistencias.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const { total, presentes, ausentes, puerta_ok } = data.resumen;

  // Presentes SIN registro de puerta y Puerta SIN marcación del docente
  const soloDocente   = data.asistencias.filter(r =>  r.presente && !r.asistencia_puerta).length;
  const soloPuerta    = data.asistencias.filter(r => !r.presente &&  r.asistencia_puerta).length;
  const ambos         = data.asistencias.filter(r =>  r.presente &&  r.asistencia_puerta).length;

  const pct = total > 0 ? Math.round((presentes / total) * 100) : 0;

  // Barra de asistencia visual (10 bloques)
  const barFill = Math.round(pct / 10);
  const bar = '█'.repeat(barFill) + '░'.repeat(10 - barFill);

  let text = `📋 <b>Asistencias · ${escapeHtml(nombreCompleto)}</b>\n`;
  text += `<code>DNI: ${escapeHtml(data.alumno.dni)}</code>\n\n`;

  // --- Resumen ---
  text += `📊 <b>Resumen general</b>\n`;
  text += `<code>${bar}</code> <b>${pct}%</b> de asistencia\n\n`;

  text += `🏫 <b>Registro del docente:</b>\n`;
  text += `  ✅ Presente: <b>${presentes}</b>  ❌ Ausente: <b>${ausentes}</b>  (Total: ${total})\n\n`;

  text += `🚦 <b>Registro de puerta:</b>\n`;
  if (puerta_ok > 0) {
    text += `  ✅ Ingresaron: <b>${puerta_ok}</b>  \u274c Sin registro: <b>${total - puerta_ok}</b>\n`;
  } else {
    text += `  <i>Sin registros de puerta aún.</i>\n`;
  }

  if (ambos > 0 || soloDocente > 0 || soloPuerta > 0) {
    text += `\n📌 <b>Combinaciones:</b>\n`;
    if (ambos > 0)      text += `  ✅🚦 Docente + Puerta: <b>${ambos}</b>\n`;
    if (soloDocente > 0) text += `  ✅　 Solo docente (sin puerta): <b>${soloDocente}</b>\n`;
    if (soloPuerta > 0)  text += `  🚦❌ Puerta sí, docente no: <b>${soloPuerta}</b>\n`;
  }

  // --- Detalle de registros ---
  if (slice.length === 0) {
    text += `\n<i>Sin registros de asistencia aún.</i>\n`;
  } else {
    text += `\n<b>Últimas clases</b> (pág. ${safePage + 1}/${totalPages}):\n`;
    for (const r of slice) {
      // Formatear fecha YYYY-MM-DD → DD/MM/YYYY
      const [y, m, d] = r.fecha.split('-');
      const fechaFmt = `${d}/${m}/${y}`;

      // Línea 1: fecha + deporte + categoría + horario
      text += `<b>${fechaFmt}</b> · ${escapeHtml(r.deporte)} · <i>${escapeHtml(r.categoria)}</i>\n`;
      text += `  ${escapeHtml(r.dia)} ${r.hora_inicio}–${r.hora_fin}\n`;

      // Línea 2: estado del docente
      const iconoDocente = r.presente ? '✅ Presente' : '❌ Ausente';
      text += `  🏫 Docente: <b>${iconoDocente}</b>`;

      // Línea 3: estado de puerta (en la misma línea, separado por ·)
      if (r.asistencia_puerta) {
        const horaStr = r.hora_puerta ? ` ${r.hora_puerta}` : '';
        text += `  🚦 Puerta: <b>✅ Ingresó${horaStr}</b>`;
      } else {
        text += `  🚦 Puerta: <b>— No registrada</b>`;
      }
      text += `\n`;

      if (r.observaciones) {
        text += `  📝 <i>${escapeHtml(r.observaciones)}</i>\n`;
      }
      text += `\n`;
    }
  }

  // Teclado de navegación
  const kb = new InlineKeyboard();
  const dniKey = data.alumno.dni;
  if (safePage > 0) {
    kb.text('⬅️ Anterior', `asist_page_${dniKey}_${safePage - 1}`);
  }
  if (safePage < totalPages - 1) {
    kb.text('Siguiente ➡️', `asist_page_${dniKey}_${safePage + 1}`);
  }
  if (safePage > 0 || safePage < totalPages - 1) kb.row();
  kb.text('🔙 Volver al Menú', 'action_back_menu');

  return { text, keyboard: kb };
}

/**
 * Renderiza el panel de control de asistencia de docentes (quiénes pasaron lista y quiénes faltan).
 */
export function renderDocentesControl(
  data: JagDocentesControlResumen
): { text: string; keyboard: InlineKeyboard } {
  let text = `👨‍🏫 <b>Control de Asistencia de Docentes</b>\n`;
  text += `📅 <b>${escapeHtml(data.diaNombre)}, ${escapeHtml(data.fecha)}</b>\n`;
  text += `👥 Docentes activos en la escuela: <b>${data.totalDocentesActivos}</b>\n\n`;

  // 1. Clases donde ya pasaron lista
  if (data.pasaronLista.length > 0) {
    text += `✅ <b>Ya pasaron lista (${data.pasaronLista.length}):</b>\n`;
    for (const c of data.pasaronLista) {
      text += `• <b>${escapeHtml(c.profesor)}</b>\n`;
      text += `  🏅 ${escapeHtml(c.deporte)} (${escapeHtml(c.categoria)}) · ⏰ ${c.hora_inicio} – ${c.hora_fin}\n`;
      text += `  📊 <b>${c.total_alumnos}</b> alumnos · 👨‍🏫 <b>${c.presentes}</b> presentes · 🚪 <b>${c.puerta_ok}</b> puerta\n\n`;
    }
  } else {
    text += `ℹ️ <i>Aún ningún docente ha registrado lista para esta fecha.</i>\n\n`;
  }

  // 2. Clases pendientes de pasar lista
  if (data.pendientes.length > 0) {
    text += `⏳ <b>Pendientes de pasar lista (${data.pendientes.length}):</b>\n`;
    for (const c of data.pendientes) {
      text += `• <b>${escapeHtml(c.profesor)}</b>\n`;
      text += `  🏅 ${escapeHtml(c.deporte)} (${escapeHtml(c.categoria)}) · ⏰ ${c.hora_inicio} – ${c.hora_fin}\n`;
      text += `  👥 ~${c.total_alumnos} inscritos · ⚠️ <i>Sin lista aún</i>\n\n`;
    }
  } else if (data.pasaronLista.length > 0) {
    text += `🎉 <i>¡Todos los docentes programados para hoy ya pasaron lista!</i>\n\n`;
  }

  const kb = new InlineKeyboard();
  // Botones para ver alumnos de las clases que ya pasaron lista (máximo 4 botones directos)
  const buttonsClase = data.pasaronLista.slice(0, 4);
  for (const c of buttonsClase) {
    const profShort = c.profesor.split(' ')[0] || c.profesor;
    kb.text(`📋 Ver lista: ${profShort} (${c.hora_inicio})`, `doc_clase_${c.horario_id}_${data.fecha}`).row();
  }
  kb.text('🔄 Actualizar', `doc_control_${data.fecha}`).text('🔙 Menú', 'action_back_menu');

  return { text, keyboard: kb };
}

/**
 * Renderiza la lista completa de alumnos evaluados en una clase por un docente.
 */
export function renderDocenteAlumnosClase(
  data: JagDocenteAlumnosClase
): { text: string; keyboard: InlineKeyboard } {
  let text = `📋 <b>Lista de Clase · ${escapeHtml(data.profesor)}</b>\n`;
  text += `🏅 <b>${escapeHtml(data.deporte)}</b> (${escapeHtml(data.categoria)}) · ⏰ <b>${data.horario}</b>\n`;
  text += `📅 Fecha: <b>${escapeHtml(data.fecha)}</b>\n\n`;

  text += `📊 <b>Resumen:</b>\n`;
  text += `• Total alumnos: <b>${data.resumen.total}</b>\n`;
  text += `• 👨‍🏫 Presentes (docente): <b>${data.resumen.presentes}</b>\n`;
  text += `• 🚪 Ingresos por puerta (carnet): <b>${data.resumen.puerta_ok}</b>\n`;
  text += `• ❌ Ausentes: <b>${data.resumen.ausentes}</b>\n\n`;

  text += `👥 <b>Alumnos registrados:</b>\n`;
  data.alumnos.forEach((a, idx) => {
    const iconDoc = a.presente ? '👨‍🏫 Presente' : '❌ Falta';
    const iconPuerta = a.asistencia_puerta
      ? `🚪 Puerta (${a.hora_puerta || 'OK'})`
      : '⛔ Sin puerta';
    text += `${idx + 1}. <b>${escapeHtml(a.nombre_completo)}</b> (DNI: <code>${escapeHtml(a.dni)}</code>)\n`;
    text += `   ${iconDoc} | ${iconPuerta}\n`;
    if (a.observaciones) {
      text += `   📝 <i>${escapeHtml(a.observaciones)}</i>\n`;
    }
  });

  const kb = new InlineKeyboard()
    .text('🔙 Volver a Control de Docentes', `doc_control_${data.fecha}`)
    .row()
    .text('🔙 Volver al Menú', 'action_back_menu');

  return { text, keyboard: kb };
}

const MESES_ES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

/**
 * Renderiza el listado de alumnos que cumplen años.
 */
export function renderBirthdays(
  students: JagBirthdayStudent[],
  periodo: string
): { text: string; keyboard: InlineKeyboard } {
  const labelPeriodo = periodo === 'hoy' ? 'Hoy' : periodo === 'semana' ? 'Esta Semana' : 'Este Mes';
  let text = `🎂 <b>Cumpleaños de Alumnos · ${labelPeriodo}</b>\n`;
  text += `🎉 <i>Total: ${students.length} cumpleañero(s)</i>\n\n`;

  if (students.length === 0) {
    text += `<i>No hay alumnos que cumplan años en este período.</i>\n\n`;
  } else {
    students.forEach((s, idx) => {
      const mesStr = MESES_ES[s.mes - 1] || s.mes;
      const diaTexto = s.dias_restantes === 0 ? '✨ <b>¡HOY!</b>' : `en ${s.dias_restantes} día(s)`;
      text += `${idx + 1}. 🎈 <b>${escapeHtml(s.nombre_completo)}</b> (Cumple <b>${s.edad_cumplir} años</b>)\n`;
      text += `   📅 ${s.dia} de ${mesStr} (${diaTexto})\n`;

      if (s.telefono) {
        const cleanTel = s.telefono.replace(/\D/g, '');
        const telPeru = cleanTel.length === 9 ? `51${cleanTel}` : cleanTel;
        const msg = encodeURIComponent(
          `¡Hola! Desde la Escuela Deportiva Jaguares queremos desearle un muy feliz cumpleaños a ${s.nombre_completo} 🎉🎂. ¡Que pase un día excelente lleno de bendiciones y deporte! 🐆⚽`
        );
        text += `   📱 <a href="https://wa.me/${telPeru}?text=${msg}">💬 Enviar saludo por WhatsApp</a>\n`;
      }
      text += `\n`;
    });
  }

  const kb = new InlineKeyboard()
    .text(periodo === 'hoy' ? '• 🎂 Hoy •' : '🎂 Hoy', 'cumple_hoy')
    .text(periodo === 'semana' ? '• 📅 Semana •' : '📅 Semana', 'cumple_semana')
    .text(periodo === 'mes' ? '• 🗓️ Mes •' : '🗓️ Mes', 'cumple_mes')
    .row()
    .text('🔙 Volver al Menú', 'action_back_menu');

  return { text, keyboard: kb };
}

/**
 * Renderiza la lista de alumnos en riesgo de deserción por inasistencias.
 */
export function renderDropoutRisk(
  students: JagDropoutRiskStudent[]
): { text: string; keyboard: InlineKeyboard } {
  let text = `📉 <b>Alerta de Deserción · Inasistencias Críticas</b>\n`;
  text += `⚠️ <i>Alumnos con 3+ faltas consecutivas o baja asistencia (&lt;50%):</i>\n\n`;

  if (students.length === 0) {
    text += `🎉 <i>¡Excelente! No se detectaron alumnos con inasistencias críticas en los últimos 45 días.</i>\n\n`;
  } else {
    students.slice(0, 10).forEach((s, idx) => {
      const alertaFaltas = s.faltas_consecutivas >= 3
        ? `🚨 <b>${s.faltas_consecutivas} faltas consecutivas</b>`
        : `⚠️ ${s.faltas_consecutivas} falta(s) seguidas`;

      text += `${idx + 1}. <b>${escapeHtml(s.nombre_completo)}</b> — 🏅 ${escapeHtml(s.deporte)}\n`;
      text += `   ${alertaFaltas} · Asistencia: <b>${s.porcentaje_asistencia}%</b> (${s.presentes}/${s.total_clases} clases)\n`;

      if (s.apoderado) {
        text += `   👤 Apoderado: ${escapeHtml(s.apoderado)}\n`;
      }

      if (s.telefono) {
        const cleanTel = s.telefono.replace(/\D/g, '');
        const telPeru = cleanTel.length === 9 ? `51${cleanTel}` : cleanTel;
        const msg = encodeURIComponent(
          `Hola, le saludamos de la Escuela Deportiva Jaguares. Nos comunicamos cordialmente con usted porque notamos que ${s.nombre_completo} no ha podido asistir a sus últimas clases de ${s.deporte}. ¿Todo bien con el alumno? ¿En qué podemos ayudarle? 🐆`
        );
        text += `   📱 <a href="https://wa.me/${telPeru}?text=${msg}">💬 Contactar por WhatsApp</a>\n`;
      }
      text += `\n`;
    });

    if (students.length > 10) {
      text += `<i>... y ${students.length - 10} alumno(s) más en riesgo.</i>\n\n`;
    }
  }

  const kb = new InlineKeyboard()
    .text('🔄 Actualizar', 'action_desercion_refresh')
    .text('🔙 Volver al Menú', 'action_back_menu');

  return { text, keyboard: kb };
}

/**
 * Renderiza los resultados de búsqueda por número de operación bancaria.
 */
export function renderOperationSearch(
  results: JagOperationSearchResult[],
  query: string
): string {
  let text = `🔍 <b>Búsqueda de Operación Bancaria · #${escapeHtml(query)}</b>\n`;
  text += `📊 Coincidencias encontradas: <b>${results.length}</b>\n\n`;

  if (results.length === 0) {
    text += `❌ <i>No se encontró ninguna inscripción ni mensualidad con el número de operación "${escapeHtml(query)}".</i>\n`;
    text += `💡 <i>Verifica si el comprobante ya fue subido o si el número ingresado tiene algún error de tipeo.</i>\n`;
    return text;
  }

  results.forEach((r, idx) => {
    const iconTipo = r.tipo === 'inscripcion' ? '🎓 Inscripción' : '💰 Mensualidad';
    const badgeEstado = r.estado === 'confirmado' || r.estado === 'confirmada'
      ? '✅ Confirmado'
      : r.estado === 'pendiente'
      ? '⏳ Pendiente de verificación'
      : '❌ Rechazado';

    text += `${idx + 1}. <b>${iconTipo}</b> · <b>${formatSoles(r.monto)}</b>\n`;
    text += `   👤 Alumno: <b>${escapeHtml(r.nombre_completo)}</b> (DNI: <code>${escapeHtml(r.dni)}</code>)\n`;
    text += `   📝 Detalle: ${escapeHtml(r.detalle)}\n`;
    text += `   📅 Fecha: ${escapeHtml(r.fecha)} · Estado: ${badgeEstado}\n`;
    text += `   🔢 N° Operación: <code>${escapeHtml(r.numero_operacion)}</code>\n`;

    if (r.comprobante_url) {
      text += `   📸 <a href="${escapeHtml(r.comprobante_url)}">Ver foto del comprobante</a>\n`;
    }
    text += `\n`;
  });

  return text;
}

/**
 * Renderiza el ranking de alumnos o el cuadro de asistencia perfecta.
 */
export function renderRanking(
  students: JagRankingStudent[],
  titulo: string = 'Ranking de Alumnos'
): string {
  let text = `🏆 <b>${escapeHtml(titulo)}</b>\n`;
  text += `📊 Total alumnos destacados: <b>${students.length}</b>\n\n`;

  if (students.length === 0) {
    text += `<i>No hay registros suficientes para este ranking aún en el mes.</i>\n`;
    return text;
  }

  students.slice(0, 15).forEach((s) => {
    const medalla = s.puesto === 1 ? '🥇' : s.puesto === 2 ? '🥈' : s.puesto === 3 ? '🥉' : `<b>${s.puesto}.</b>`;
    text += `${medalla} <b>${escapeHtml(s.nombre_completo)}</b> — 🏅 ${escapeHtml(s.deporte)}${s.categoria ? ` (${escapeHtml(s.categoria)})` : ''}\n`;
    text += `   ⭐ <b>${s.puntos} pts</b> · 📊 <b>${s.porcentaje_asistencia}%</b> de asistencia (${s.clases_asistidas}/${s.total_clases} clases)\n\n`;
  });

  return text;
}

/**
 * Renderiza la auditoría de inconsistencias: Puerta (QR) vs Docente.
 */
export function renderAttendanceDiscrepancies(
  items: JagAttendanceDiscrepancy[],
  fechaConsultada: string
): { text: string; keyboard: InlineKeyboard } {
  let text = `🚪 <b>Auditoría de Asistencias: Puerta (QR) vs Docente</b>\n`;
  text += `📅 Fecha evaluada: <b>${escapeHtml(fechaConsultada)}</b>\n\n`;

  if (items.length === 0) {
    text += `✅ <b>¡Todo en orden!</b>\n`;
    text += `No se encontraron discrepancias en esta fecha. Todos los alumnos presentes coinciden con su registro de puerta física.\n`;
    const kb = new InlineKeyboard().text('🔙 Volver al Menú', 'action_back_menu');
    return { text, keyboard: kb };
  }

  const puertaSinDoc = items.filter((i) => i.tipo_discrepancia === 'puerta_sin_docente');
  const docSinPuerta = items.filter((i) => i.tipo_discrepancia === 'docente_sin_puerta');

  text += `⚠️ Inconsistencias detectadas: <b>${items.length}</b>\n`;
  text += `• 🚪 Marcó puerta pero tiene falta del profesor: <b>${puertaSinDoc.length}</b>\n`;
  text += `• 👨‍🏫 Presente del profesor pero sin puerta: <b>${docSinPuerta.length}</b>\n\n`;

  const kb = new InlineKeyboard();

  items.slice(0, 8).forEach((item, idx) => {
    const icon = item.tipo_discrepancia === 'puerta_sin_docente' ? '🚪❓' : '👨‍🏫❓';
    const desc = item.tipo_discrepancia === 'puerta_sin_docente'
      ? `Marcó puerta (${item.hora_puerta || 'S/H'}) pero docente puso <b>FALTA</b>`
      : `Docente puso <b>PRESENTE</b> pero <b>NO marcó puerta</b>`;

    text += `${idx + 1}. ${icon} <b>${escapeHtml(item.nombre_completo)}</b> (DNI: <code>${escapeHtml(item.dni)}</code>)\n`;
    text += `   🏅 ${escapeHtml(item.deporte)} · 🕒 ${escapeHtml(item.horario)}\n`;
    if (item.profesor) text += `   👨‍🏫 Profesor: <i>${escapeHtml(item.profesor)}</i>\n`;
    text += `   🚨 ${desc}\n\n`;

    const wa = buildWhatsAppLink(item.telefono, item.nombre_completo, item.apoderado);
    if (wa && idx < 3) {
      kb.url(`💬 WA: ${item.nombre_completo.split(' ')[0]}`, wa).row();
    }
  });

  if (items.length > 8) {
    text += `<i>... y ${items.length - 8} alumnos más con discrepancias.</i>\n\n`;
  }

  kb.text('🔄 Actualizar', 'action_discrepancias')
    .text('🔙 Volver', 'action_back_menu');

  return { text, keyboard: kb };
}

/**
 * Renderiza la agenda de clases y turnos de hoy en tiempo real.
 */
export function renderTodaySchedule(
  items: JagTodayScheduleItem[],
  diaNombre: string,
  fechaStr: string
): { text: string; keyboard: InlineKeyboard } {
  let text = `📅 <b>Agenda de Clases de Hoy · ${escapeHtml(diaNombre)}</b>\n`;
  text += `🗓️ Fecha: <b>${escapeHtml(fechaStr)}</b> · Clases programadas: <b>${items.length}</b>\n\n`;

  if (items.length === 0) {
    text += `<i>Hoy no hay clases regulares programadas en el sistema.</i>\n`;
    const kb = new InlineKeyboard().text('🔙 Volver al Menú', 'action_back_menu');
    return { text, keyboard: kb };
  }

  const kb = new InlineKeyboard();

  items.forEach((item) => {
    let sportEmoji = '🏅';
    const depNorm = item.deporte.toLowerCase();
    if (depNorm.includes('futbol')) sportEmoji = '⚽';
    else if (depNorm.includes('voley')) sportEmoji = '🏐';
    else if (depNorm.includes('basquet') || depNorm.includes('básquet')) sportEmoji = '🏀';
    else if (depNorm.includes('fit') || depNorm.includes('gym')) sportEmoji = '💪';

    const estadoBadge = item.estado_asistencia === 'pasada'
      ? `✅ Lista pasada (${item.total_presentes_hoy} presentes | 🚪 ${item.total_puerta_hoy} puerta)`
      : item.estado_asistencia === 'en_curso'
      ? `⏳ En curso`
      : `🔜 Próximo turno`;

    text += `${sportEmoji} <b>${escapeHtml(item.deporte)}</b> ${item.categoria ? `(${escapeHtml(item.categoria)})` : ''}\n`;
    text += `   🕒 <b>${item.hora_inicio} - ${item.hora_fin}</b>\n`;
    if (item.profesor) text += `   👨‍🏫 Profesor: <i>${escapeHtml(item.profesor)}</i>\n`;
    text += `   👥 Ocupación: <b>${item.cupos_ocupados}/${item.cupo_maximo}</b> alumnos\n`;
    text += `   📊 Estado: <b>${estadoBadge}</b>\n\n`;
  });

  kb.text('🔄 Actualizar Agenda', 'action_today_schedule')
    .text('🔙 Volver', 'action_back_menu');

  return { text, keyboard: kb };
}

/**
 * Renderiza alertas de aforo y horarios con cupos críticos o saturados.
 */
export function renderCapacityAlerts(
  alerts: JagCapacityAlert[]
): { text: string; keyboard: InlineKeyboard } {
  let text = `🏟️ <b>Alertas de Aforo y Cupos Críticos</b>\n\n`;

  const llenos = alerts.filter((a) => a.nivel === 'lleno');
  const criticos = alerts.filter((a) => a.nivel === 'critico');
  const medios = alerts.filter((a) => a.nivel === 'medio');

  text += `📊 <b>Resumen General de Aforo:</b>\n`;
  text += `🔴 Cupos Llenos (100%): <b>${llenos.length}</b> horarios\n`;
  text += `🟡 Estado Crítico (85%-99%): <b>${criticos.length}</b> horarios\n`;
  text += `🟢 Disponibles (&lt;85%): <b>${alerts.length - llenos.length - criticos.length}</b> horarios\n\n`;

  const prioritarios = [...llenos, ...criticos, ...medios].slice(0, 10);

  if (prioritarios.length === 0) {
    text += `✅ <i>Todos los horarios tienen cupos holgados y disponibles actualmente.</i>\n`;
  } else {
    text += `🚨 <b>Horarios con mayor demanda:</b>\n`;
    prioritarios.forEach((a, idx) => {
      const badge = a.nivel === 'lleno' ? '🔴 LLENO' : a.nivel === 'critico' ? '🟡 CRÍTICO' : '🟢 MEDIO';
      text += `${idx + 1}. <b>${escapeHtml(a.deporte)}</b> (${escapeHtml(a.dia)} ${a.hora_inicio}-${a.hora_fin})\n`;
      text += `   📊 ${badge}: <b>${a.cupos_ocupados}/${a.cupo_maximo}</b> (${a.porcentaje_ocupacion}%) · <b>${a.vacantes_disponibles} vacantes</b>\n\n`;
    });
  }

  const kb = new InlineKeyboard()
    .text('📥 Descargar Excel de Cupos', 'excel_dl_capacity')
    .row()
    .text('🔙 Volver al Menú', 'action_back_menu');

  return { text, keyboard: kb };
}

/**
 * Renderiza la comparativa mes a mes (crecimiento MoM).
 */
export function renderMonthlyComparison(
  comp: JagMonthlyComparison
): { text: string; keyboard: InlineKeyboard } {
  let text = `📈 <b>Comparativa de Crecimiento · Jaguares BI</b>\n`;
  text += `Comparando: <b>${escapeHtml(comp.mes_actual)} ${comp.anio_actual}</b> vs <b>${escapeHtml(comp.mes_anterior)} ${comp.anio_anterior}</b>\n\n`;

  const iconIng = comp.variacion_ingresos_pct >= 0 ? '🟢 📈' : '🔴 📉';
  const iconInsc = comp.variacion_inscripciones_pct >= 0 ? '🟢 📈' : '🔴 📉';

  text += `💰 <b>Ingresos Recaudados (Confirmados):</b>\n`;
  text += `• ${comp.mes_actual}: <b>${formatSoles(comp.ingresos_actual)}</b>\n`;
  text += `• ${comp.mes_anterior}: ${formatSoles(comp.ingresos_anterior)}\n`;
  text += `• Variación: ${iconIng} <b>${comp.variacion_ingresos_pct >= 0 ? '+' : ''}${comp.variacion_ingresos_pct}%</b>\n\n`;

  text += `🆕 <b>Nuevas Matrículas / Inscripciones:</b>\n`;
  text += `• ${comp.mes_actual}: <b>${comp.inscripciones_actual}</b> nuevos alumnos\n`;
  text += `• ${comp.mes_anterior}: ${comp.inscripciones_anterior} nuevos alumnos\n`;
  text += `• Variación: ${iconInsc} <b>${comp.variacion_inscripciones_pct >= 0 ? '+' : ''}${comp.variacion_inscripciones_pct}%</b>\n\n`;

  text += `👥 <b>Padrón de Alumnos Activos:</b> <b>${comp.alumnos_activos}</b> alumnos\n`;
  text += `⏳ <b>Cobranzas Pendientes (Deuda):</b> ${formatSoles(comp.deuda_actual)} (mes anterior: ${formatSoles(comp.deuda_anterior)})\n\n`;

  const kb = new InlineKeyboard()
    .text('📊 Ver Resumen General', 'action_overview')
    .text('🔙 Volver', 'action_back_menu');

  return { text, keyboard: kb };
}

/**
 * Renderiza el desglose financiero por método de pago.
 */
export function renderPaymentMethodsBreakdown(
  data: { methods: JagPaymentMethodBreakdown[]; totalMonto: number; totalPagos: number; mesNombre: string }
): { text: string; keyboard: InlineKeyboard } {
  let text = `💳 <b>Desglose por Método de Pago</b>\n`;
  text += `📅 Período: <b>${escapeHtml(data.mesNombre)}</b>\n\n`;
  text += `💰 <b>Total Recaudado:</b> <b>${formatSoles(data.totalMonto)}</b> (${data.totalPagos} pagos confirmados)\n\n`;

  if (data.methods.length === 0) {
    text += `<i>No hay pagos registrados para este período aún.</i>\n`;
  } else {
    data.methods.forEach((m) => {
      let icon = '💳';
      const mNorm = m.metodo.toLowerCase();
      if (mNorm.includes('yape')) icon = '🟣';
      else if (mNorm.includes('plin')) icon = '🔵';
      else if (mNorm.includes('bcp') || mNorm.includes('bbva') || mNorm.includes('transfer')) icon = '🏦';
      else if (mNorm.includes('efectivo')) icon = '💵';

      text += `${icon} <b>${escapeHtml(m.metodo)}:</b> <b>${formatSoles(m.total_monto)}</b> (${m.porcentaje_total}%)\n`;
      text += `   📊 Cantidad de pagos: <b>${m.cantidad_pagos}</b> operaciones\n\n`;
    });
  }

  const kb = new InlineKeyboard()
    .text('📸 Ver Vouchers', 'action_vouchers')
    .text('🔙 Volver', 'action_back_menu');

  return { text, keyboard: kb };
}

/**
 * Renderiza el menú interactivo de plantillas de difusión por WhatsApp.
 */
export function renderWhatsAppTemplatesMenu(): { text: string; keyboard: InlineKeyboard } {
  let text = `💬 <b>Generador de Plantillas Rápidas para WhatsApp</b>\n\n`;
  text += `Elige una plantilla para ver el texto preformateado y abrirlo directamente en WhatsApp:\n\n`;
  text += `1️⃣ <b>Recordatorio Amable de Cobro de Mensualidad</b>\n`;
  text += `2️⃣ <b>Mensaje de Bienvenida al Alumno</b>\n`;
  text += `3️⃣ <b>Aviso de Feriado o Clases Suspendidas</b>\n`;
  text += `4️⃣ <b>Felicitación por Asistencia Perfecta (100%)</b>\n`;

  const kb = new InlineKeyboard()
    .text('💬 1. Recordatorio Cobro', 'tmpl_cobro')
    .text('💬 2. Bienvenida', 'tmpl_bienvenida')
    .row()
    .text('💬 3. Aviso Feriado', 'tmpl_feriado')
    .text('💬 4. Asistencia 100%', 'tmpl_asistencia')
    .row()
    .text('🔙 Volver al Menú', 'action_back_menu');

  return { text, keyboard: kb };
}

/**
 * Renderiza el diagnóstico y salud operativa técnica del bot y MySQL.
 */
export function renderSystemHealth(
  health: JagSystemHealth
): { text: string; keyboard: InlineKeyboard } {
  const dbIcon = health.db_status === 'online' ? '🟢 Online' : '🔴 Error de conexión';

  let text = `🩺 <b>Diagnóstico y Salud del Sistema · Escuela Jaguares</b>\n\n`;
  text += `🗄️ <b>Base de Datos MySQL:</b> ${dbIcon} (${health.db_latency_ms} ms de latencia)\n`;
  text += `🔔 <b>Vigilante de Pagos en Vivo:</b> 🟢 ${escapeHtml(health.watcher_status)}\n`;
  if (health.last_payment_date) {
    text += `   🕒 Último comprobante recibido: <b>${escapeHtml(health.last_payment_date)}</b>\n`;
  }
  text += `👥 <b>Total Alumnos en Sistema:</b> <b>${health.total_alumnos}</b>\n`;
  text += `🎓 <b>Inscripciones Activas:</b> <b>${health.total_inscripciones_activas}</b>\n`;
  text += `🏟️ <b>Horarios de Entrenamiento:</b> <b>${health.total_horarios_activos}</b>\n\n`;

  const upHours = Math.floor(health.uptime_seconds / 3600);
  const upMins = Math.floor((health.uptime_seconds % 3600) / 60);
  text += `⏱️ <b>Tiempo activo (Uptime):</b> ${upHours}h ${upMins}m\n`;
  text += `🕒 <b>Hora Oficial Perú:</b> <code>${health.server_time}</code>\n\n`;
  text += `<i>El bot opera con conexiones de solo lectura protegidas y caché de optimización de tokens activada.</i>`;

  const kb = new InlineKeyboard()
    .text('🔄 Actualizar Diagnóstico', 'action_system_health')
    .text('🔙 Volver al Menú', 'action_back_menu');

  return { text, keyboard: kb };
}



