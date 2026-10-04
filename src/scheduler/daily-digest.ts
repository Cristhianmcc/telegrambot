import cron from 'node-cron';
import { Bot, InlineKeyboard } from 'grammy';
import { DateTime } from 'luxon';
import { accessStore } from '../auth/access-store.js';
import { jaguaresService } from '../connectors/jaguares/jaguares-service.js';
import { resolvePeriod } from '../date-resolver/date-resolver.js';

/**
 * Genera el texto HTML del Daily Digest para la Escuela Jaguares.
 */
export async function buildDailyDigestHtml(userName: string): Promise<string> {
  const limaNow = DateTime.now().setZone('America/Lima');
  const hour = limaNow.hour;
  const greeting = hour < 12 ? '🌅 ¡Buenos días' : hour < 19 ? '☀️ ¡Buenas tardes' : '🌙 ¡Buenas noches';

  const period = resolvePeriod('este mes');
  const [overview, studentCounts, debtSummary, pendingDebtors] = await Promise.all([
    jaguaresService.getOverview(period).catch(() => null),
    jaguaresService.getStudentCounts().catch(() => null),
    jaguaresService.getDebtSummary(period).catch(() => null),
    jaguaresService.getPendingDebtors(period, 5).catch(() => [])
  ]);

  const dateStr = limaNow.setLocale('es').toFormat("EEEE, d 'de' MMMM yyyy");
  const formattedDate = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);

  const totalAlumnos = studentCounts ? studentCounts.totalStudents : (overview?.activeStudents ?? 0);
  const totalCobrado = overview?.incomeThisMonth ?? 0;
  const totalPendiente = debtSummary?.totalDebtAmount ?? (overview?.pendingDebtAmount ?? 0);
  const numDeudores = debtSummary?.totalDebtors ?? (overview?.pendingDebtCount ?? pendingDebtors.length);

  let html =
    `<b>${greeting}, ${userName}!</b>\n` +
    `📊 <b>Reporte Resumen · Escuela Jaguares</b>\n` +
    `📅 <i>${formattedDate} (${limaNow.toFormat('hh:mm a')})</i>\n\n` +
    `📈 <b>Métricas Clave del Mes:</b>\n` +
    `• 👥 <b>Alumnos Activos:</b> ${totalAlumnos}\n` +
    `• 💰 <b>Cobrado en ${period.label}:</b> S/ ${totalCobrado.toLocaleString('es-PE', { minimumFractionDigits: 2 })}\n` +
    `• ⏳ <b>Por Cobrar:</b> S/ ${totalPendiente.toLocaleString('es-PE', { minimumFractionDigits: 2 })} (${numDeudores} pendientes)\n\n`;

  if (pendingDebtors.length > 0) {
    html += `🚨 <b>Principales Cobranzas Pendientes:</b>\n`;
    pendingDebtors.slice(0, 3).forEach((d) => {
      html += `• ${d.nombreCompleto}: S/ ${d.monto.toFixed(2)} (${d.telefonoApoderado || 'Sin tel'})\n`;
    });
    html += `\n`;
  }

  html +=
    `💡 <i>Puedes descargar la lista completa en Excel con /excel o escribir cualquier pregunta al bot.</i>`;

  return html;
}

/**
 * Envía el Daily Digest a un usuario específico.
 */
export async function sendDailyDigestToUser(bot: Bot, userId: number): Promise<void> {
  const membership = accessStore.getMembership(userId);
  const name = membership?.firstName || 'Director';
  const html = await buildDailyDigestHtml(name);

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
          console.log(`⏰ [DailyDigest] Enviando reporte programado (${targetHour}) a usuario ${m.telegramUserId} (${m.firstName})...`);
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
