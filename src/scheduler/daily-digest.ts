import cron from 'node-cron';
import { Bot, InlineKeyboard } from 'grammy';
import { DateTime } from 'luxon';
import { accessStore, NotificationOptions, DEFAULT_NOTIFICATION_OPTIONS } from '../auth/access-store.js';
import { jaguaresService } from '../connectors/jaguares/jaguares-service.js';
import { resolvePeriod } from '../date-resolver/date-resolver.js';

/**
 * Genera el texto HTML del Daily Digest para la Escuela Jaguares respetando las opciones seleccionadas.
 */
export async function buildDailyDigestHtml(
  userName: string,
  options: NotificationOptions = DEFAULT_NOTIFICATION_OPTIONS
): Promise<string> {
  const limaNow = DateTime.now().setZone('America/Lima');
  const hour = limaNow.hour;
  const greeting = hour < 12 ? '🌅 ¡Buenos días' : hour < 19 ? '☀️ ¡Buenas tardes' : '🌙 ¡Buenas noches';
  const period = resolvePeriod('este mes');

  // Consultar en paralelo solo los datos necesarios
  const [overview, studentCounts, debtSummary, pendingDebtors, capacityData, recentStudents] =
    await Promise.all([
      jaguaresService.getOverview(period).catch(() => null),
      options.includeStudents ? jaguaresService.getStudentCounts().catch(() => null) : null,
      options.includeDebts ? jaguaresService.getDebtSummary(period).catch(() => null) : null,
      options.includeDebts ? jaguaresService.getPendingDebtors(period, 5).catch(() => []) : [],
      options.includeCapacity ? jaguaresService.getCapacity().catch(() => null) : null,
      options.includeNewStudents ? jaguaresService.getRecentStudents(3).catch(() => []) : []
    ]);

  const dateStr = limaNow.setLocale('es').toFormat("EEEE, d 'de' MMMM yyyy");
  const formattedDate = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

  let html =
    `<b>${greeting}, ${userName}!</b>\n` +
    `📊 <b>Reporte Resumen · Escuela Jaguares</b>\n` +
    `📅 <i>${formattedDate} (${limaNow.toFormat('hh:mm a')})</i>\n\n`;

  let hasSections = false;

  // 1. Sección Alumnos Activos
  if (options.includeStudents) {
    hasSections = true;
    const totalAlumnos = studentCounts ? studentCounts.totalStudents : (overview?.activeStudents ?? 0);
    html += `👥 <b>Alumnos Activos:</b> ${totalAlumnos}\n`;
    if (studentCounts?.byDiscipline && studentCounts.byDiscipline.length > 0) {
      const top3 = studentCounts.byDiscipline.slice(0, 3);
      const discText = top3.map((d) => `${d.discipline}: ${d.count}`).join(' | ');
      html += `   <i>(${discText})</i>\n`;
    }
  }

  // 2. Sección Ingresos del Mes
  if (options.includeIncome) {
    hasSections = true;
    const totalCobrado = overview?.incomeThisMonth ?? 0;
    html += `💰 <b>Cobrado en ${period.label}:</b> S/ ${totalCobrado.toLocaleString('es-PE', { minimumFractionDigits: 2 })}\n`;
  }

  // 3. Sección Cobranzas y Deudores
  if (options.includeDebts) {
    hasSections = true;
    const totalPendiente = debtSummary?.totalDebtAmount ?? (overview?.pendingDebtAmount ?? 0);
    const numDeudores = debtSummary?.totalDebtors ?? (overview?.pendingDebtCount ?? pendingDebtors.length);
    html += `⏳ <b>Por Cobrar:</b> S/ ${totalPendiente.toLocaleString('es-PE', { minimumFractionDigits: 2 })} (${numDeudores} deudores)\n`;

    if (pendingDebtors.length > 0) {
      html += `\n🚨 <b>Principales Cobranzas Pendientes:</b>\n`;
      pendingDebtors.slice(0, 3).forEach((d) => {
        html += `• ${d.nombreCompleto}: S/ ${d.monto.toFixed(2)} (${d.telefonoApoderado || 'Sin tel'})\n`;
      });
    }
  }

  // 4. Sección Cupos y Capacidad
  if (options.includeCapacity && capacityData?.items) {
    hasSections = true;
    html += `\n🏟️ <b>Estado de Cupos por Disciplina:</b>\n`;
    capacityData.items.slice(0, 4).forEach((c) => {
      const icon = c.occupancyPct >= 85 ? '🔴' : c.occupancyPct >= 60 ? '🟡' : '🟢';
      html += `• ${icon} <b>${c.discipline}:</b> ${c.occupiedCapacity}/${c.totalCapacity} (${c.occupancyPct}%)\n`;
    });
  }

  // 5. Sección Nuevos Alumnos
  if (options.includeNewStudents && recentStudents && recentStudents.length > 0) {
    hasSections = true;
    html += `\n🆕 <b>Últimas Matrículas Registradas:</b>\n`;
    recentStudents.forEach((s) => {
      html += `• ${s.nombreCompleto} (${s.deporte} - ${s.fechaInscripcion})\n`;
    });
  }

  if (!hasSections) {
    html += `ℹ️ <i>No tienes ningún módulo activo para este reporte. Configúralos en /notificaciones</i>\n`;
  }

  html += `\n💡 <i>Descarga reportes en Excel con /excel o configura qué recibir con /notificaciones.</i>`;

  return html;
}

/**
 * Envía el Daily Digest a un usuario específico.
 */
export async function sendDailyDigestToUser(bot: Bot, userId: number): Promise<void> {
  const membership = accessStore.getMembership(userId);
  const name = membership?.firstName || 'Director';
  const options = accessStore.getNotificationOptions(userId);
  const html = await buildDailyDigestHtml(name, options);

  const kb = new InlineKeyboard()
    .text('📊 Ver Resumen Completo', 'action_overview')
    .text('📥 Descargar Excel', 'excel_menu');

  await bot.api.sendMessage(userId, html, {
    parse_mode: 'HTML',
    reply_markup: kb
  });
}

/**
 * Inicia el cron job que evalúa cada minuto si corresponde enviar el reporte matutino o nocturno.
 */
export function initDailyDigestScheduler(bot: Bot): void {
  // Ejecutar cada minuto
  cron.schedule('* * * * *', async () => {
    try {
      const limaNow = DateTime.now().setZone('America/Lima');
      const currentHHmm = limaNow.toFormat('HH:mm'); // ej: '08:00'
      const todayDateStr = limaNow.toFormat('yyyy-MM-dd');

      const memberships = accessStore.listMemberships();

      for (const m of memberships) {
        if (m.status !== 'active') continue;

        // Comprobar si tiene el digest activado
        const isEnabled = m.dailyDigestEnabled ?? false;
        if (!isEnabled) continue;

        const targetHour = m.digestHour || '08:00';

        // Si coincide la hora configurada y aún no se le envió hoy
        if (targetHour === currentHHmm && m.lastDigestSentDate !== todayDateStr) {
          console.log(`⏰ [DailyDigest] Enviando reporte (${targetHour}) a usuario ${m.telegramUserId} (${m.firstName})...`);
          try {
            await sendDailyDigestToUser(bot, m.telegramUserId);
            accessStore.recordDigestSent(m.telegramUserId, todayDateStr);
          } catch (err: any) {
            console.error(`❌ Error enviando DailyDigest a ${m.telegramUserId}:`, err.message);
          }
        }
      }
    } catch (globalErr: any) {
      console.error('⚠️ Error en cron de DailyDigest:', globalErr.message);
    }
  });

  console.log('⏰ Programador de Reportes Diarios (Daily Digest) activado.');
}
