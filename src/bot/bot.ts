import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { routeMessage } from '../pipeline/rule-router.js';
import { routeMessageWithLLM } from '../llm/llm-router.js';
import { jaguaresService } from '../connectors/jaguares/jaguares-service.js';
import {
  renderOverview,
  renderStudentCounts,
  renderIncomeSummary,
  renderDebtSummary,
  renderPendingDebtors,
  renderCapacity,
  renderEnrollments,
  renderRecentStudents,
  renderStudentDetail,
  renderVoucherDetail,
  markdownToTelegramHtml,
  escapeHtml
} from '../rendering/jaguares-templates.js';
import { transcribeAudioUrl } from '../audio/transcription.js';
import { fetchImageBuffer } from '../utils/image-fetcher.js';
import { resolvePeriod } from '../date-resolver/date-resolver.js';
import { getChatHistory, addChatMessage, clearChatHistory } from './conversation-memory.js';
import { accessStore } from '../auth/access-store.js';
import { registerAdminPanel } from './admin-panel.js';
import {
  generateDebtorsExcelBuffer,
  generateStudentsExcelBuffer,
  generateCapacityExcelBuffer
} from '../reporting/excel-generator.js';
import { sendDailyDigestToUser } from '../scheduler/daily-digest.js';

export const BOT_SLASH_COMMANDS = [
  { command: 'menu', description: '📋 Menú interactivo principal' },
  { command: 'buscar', description: '🔍 Buscar alumno y WhatsApp de cobranza' },
  { command: 'comprobantes', description: '📸 Ver vouchers y comprobantes Yape/Plin' },
  { command: 'resumen', description: '🎓 Resumen general de la escuela' },
  { command: 'alumnos', description: '👥 Alumnos activos y por disciplina' },
  { command: 'ingresos', description: '💰 Ingresos cobrados en el mes' },
  { command: 'deudas', description: '📋 Balance de cobranzas y deudas' },
  { command: 'deudores', description: '⏳ Lista de alumnos con mensualidad pendiente' },
  { command: 'cupos', description: '🏟️ Estado de cupos y horarios' },
  { command: 'excel', description: '📊 Descargar reportes en Excel (.xlsx)' },
  { command: 'notificaciones', description: '⏰ Configurar alertas y reporte diario' },
  { command: 'ayuda', description: '❓ Ejemplos de consultas y guía' },
  { command: 'admin', description: '👑 Panel de administración comercial' }
];

export async function registerBotSlashCommands(bot: Bot): Promise<void> {
  try {
    await bot.api.setMyCommands(BOT_SLASH_COMMANDS);
    console.log('✅ Comandos Slash (/) registrados exitosamente en Telegram.');
  } catch (err: any) {
    console.warn('⚠️ No se pudieron registrar comandos slash en Telegram:', err.message);
  }
}

export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // Registrar panel de administración comercial para el dueño del bot
  registerAdminPanel(bot);

  function getMainKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
      .text('🎓 Resumen General', 'action_overview')
      .text('👥 Alumnos', 'action_students')
      .row()
      .text('💰 Ingresos del Mes', 'action_income')
      .text('📋 Deudas y Cobranzas', 'action_debt')
      .row()
      .text('⏳ Quiénes Deben', 'action_debtors')
      .text('🏟️ Cupos y Horarios', 'action_capacity')
      .row()
      .text('🔍 Buscar Alumno', 'action_prompt_search')
      .text('📸 Vouchers Yape/Plin', 'action_vouchers')
      .row()
      .text('📊 Reportes Excel (.xlsx)', 'excel_menu')
      .text('⏰ Alertas y Notificaciones', 'notif_menu');
  }

  function getExcelKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
      .text('📑 Deudores (.xlsx)', 'excel_dl_debtors')
      .text('👥 Padrón Alumnos (.xlsx)', 'excel_dl_students')
      .row()
      .text('🏟️ Horarios y Cupos (.xlsx)', 'excel_dl_capacity')
      .row()
      .text('🔙 Volver al Menú', 'action_back_menu');
  }

  function getNotificationsView(userId: number): { text: string; keyboard: InlineKeyboard } {
    const membership = accessStore.getMembership(userId);
    const isEnabled = membership?.dailyDigestEnabled ?? true;
    const hour = membership?.digestHour || '08:00';
    const opts = accessStore.getNotificationOptions(userId);

    const statusBadge = isEnabled
      ? `✅ <b>Activado</b> (se envía a las <b>${hour}</b> hora Perú)`
      : `❌ <b>Pausado</b>`;

    const message =
      `🔔 <b>Configuración de Notificaciones · Escuela Jaguares</b>\n\n` +
      `Personaliza exactamente qué información deseas recibir en tus reportes automáticos:\n\n` +
      `📌 <b>Módulos activos:</b>\n` +
      `• 👥 Alumnos Activos: ${opts.includeStudents ? '✅ <i>Incluido</i>' : '❌ <i>Omitido</i>'}\n` +
      `• 💰 Ingresos del Mes: ${opts.includeIncome ? '✅ <i>Incluido</i>' : '❌ <i>Omitido</i>'}\n` +
      `• 🚨 Cobranzas y Deudores: ${opts.includeDebts ? '✅ <i>Incluido</i>' : '❌ <i>Omitido</i>'}\n` +
      `• 🏟️ Cupos y Horarios: ${opts.includeCapacity ? '✅ <i>Incluido</i>' : '❌ <i>Omitido</i>'}\n` +
      `• 🆕 Nuevas Matrículas: ${opts.includeNewStudents ? '✅ <i>Incluido</i>' : '❌ <i>Omitido</i>'}\n\n` +
      `⏰ <b>Horario programado:</b> ${hour} Perú\n` +
      `📊 <b>Estado de entrega:</b> ${statusBadge}\n\n` +
      `👇 <i>Toca los botones para activar/desactivar cada tema:</i>`;

    const kb = new InlineKeyboard()
      .text(opts.includeStudents ? '👥 Alumnos: ✅' : '👥 Alumnos: ❌', 'notif_tog_students')
      .text(opts.includeIncome ? '💰 Ingresos: ✅' : '💰 Ingresos: ❌', 'notif_tog_income')
      .row()
      .text(opts.includeDebts ? '🚨 Cobranzas: ✅' : '🚨 Cobranzas: ❌', 'notif_tog_debts')
      .text(opts.includeCapacity ? '🏟️ Cupos: ✅' : '🏟️ Cupos: ❌', 'notif_tog_capacity')
      .row()
      .text(opts.includeNewStudents ? '🆕 Nuevos: ✅' : '🆕 Nuevos: ❌', 'notif_tog_newstudents')
      .row()
      .text(`⏰ Cambiar Hora (${hour})`, 'notif_pick_hour')
      .text('🚀 Probar envío ahora', 'notif_test_now')
      .row()
      .text(isEnabled ? '🔕 Pausar Notificaciones' : '🔔 Activar Notificaciones', isEnabled ? 'notif_disable' : 'notif_enable')
      .row()
      .text('🔙 Volver al Menú', 'action_back_menu');

    return { text: message, keyboard: kb };
  }

  function getHourSelectionView(userId: number): { text: string; keyboard: InlineKeyboard } {
    const membership = accessStore.getMembership(userId);
    const currentHour = membership?.digestHour || '08:00';

    const message =
      `⏰ <b>Seleccionar Horario de Notificación</b>\n\n` +
      `Elige a qué hora deseas recibir tu reporte automático diario (hora de Perú UTC-5):\n\n` +
      `Horario actual: <b>${currentHour}</b>`;

    const kb = new InlineKeyboard()
      .text(currentHour === '07:00' ? '🔘 07:00 AM' : '⚪ 07:00 AM', 'notif_set_07:00')
      .text(currentHour === '08:00' ? '🔘 08:00 AM' : '⚪ 08:00 AM', 'notif_set_08:00')
      .text(currentHour === '09:00' ? '🔘 09:00 AM' : '⚪ 09:00 AM', 'notif_set_09:00')
      .row()
      .text(currentHour === '14:00' ? '🔘 02:00 PM' : '⚪ 02:00 PM', 'notif_set_14:00')
      .text(currentHour === '20:00' ? '🔘 08:00 PM' : '⚪ 08:00 PM', 'notif_set_20:00')
      .row()
      .text('🔙 Volver a Notificaciones', 'notif_menu_edit');

    return { text: message, keyboard: kb };
  }

  // --- HELPER BÚSQUEDA DE ALUMNO ---
  async function handleStudentSearch(ctx: any, term: string) {
    const cleanTerm = term.trim();
    if (!cleanTerm) {
      await ctx.reply(
        `🔍 <b>Búsqueda de Alumnos · Escuela Jaguares</b>\n\n` +
          `Escribe el nombre, apellido o DNI del alumno para ver su ficha y contactar a su apoderado por WhatsApp.\n\n` +
          `Ejemplos:\n` +
          `• <code>/buscar Huamani</code>\n` +
          `• <code>/buscar 74859612</code>\n` +
          `• O simplemente escribe el DNI directo en el chat.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const waitMsg = await ctx.reply(`🔍 Buscando a <i>"${cleanTerm}"</i>...`, { parse_mode: 'HTML' });

    try {
      const students = await jaguaresService.searchStudents(cleanTerm, 5);
      await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});

      if (students.length === 0) {
        await ctx.reply(
          `❌ No se encontró ningún alumno con el término <b>"${cleanTerm}"</b>.\n\n` +
            `Verifica si el DNI o apellido está bien escrito o consulta el padrón con /alumnos.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      if (students.length === 1) {
        const student = students[0];
        const view = renderStudentDetail(student);
        await ctx.reply(view.text, {
          parse_mode: 'HTML',
          reply_markup: view.keyboard
        });
        return;
      }

      // Varios resultados: mostrar selector
      let text = `🔍 <b>Se encontraron ${students.length} alumnos para "${cleanTerm}":</b>\n\n`;
      const kb = new InlineKeyboard();

      students.forEach((s, idx) => {
        text += `${idx + 1}. <b>${s.nombreCompleto}</b> (DNI: <code>${s.dni}</code>)\n`;
        if (s.deuda.tieneDeuda) {
          text += `   🚨 Debe: S/ ${s.deuda.totalDeuda.toFixed(2)}\n`;
        } else {
          text += `   ✅ Al día\n`;
        }
        kb.text(`👤 ${s.nombres} (${s.dni})`, `student_view_${s.alumnoId}`).row();
      });

      kb.text('🔙 Volver al Menú', 'action_back_menu');

      text += `\n👇 <i>Selecciona un alumno para ver su ficha completa y contactar por WhatsApp:</i>`;

      await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: kb
      });
    } catch (err: any) {
      await ctx.reply(`⚠️ Error en la búsqueda: ${err.message}`);
    }
  }

  // --- HELPER CONSULTA DE COMPROBANTES ---
  async function handleVouchersList(ctx: any, filter?: string) {
    const waitMsg = await ctx.reply('📸 Consultando comprobantes en tiempo real...');
    try {
      const vouchers = await jaguaresService.getRecentVouchers(5, filter);
      await ctx.api.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});

      if (vouchers.length === 0) {
        await ctx.reply(
          filter
            ? `ℹ️ No se encontraron comprobantes para <b>"${filter}"</b>.`
            : `ℹ️ No hay comprobantes de pago subidos recientemente.`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      await ctx.reply(
        `📸 <b>Últimos ${vouchers.length} Comprobantes de Pago Registrados</b>\n` +
          `Verificados en la plataforma de Escuela Jaguares:`,
        { parse_mode: 'HTML' }
      );

      for (const v of vouchers) {
        const view = renderVoucherDetail(v);
        let sentWithPhoto = false;

        if (v.comprobanteUrl) {
          try {
            const imageInfo = await fetchImageBuffer(v.comprobanteUrl);
            if (imageInfo) {
              await ctx.replyWithPhoto(new InputFile(imageInfo.buffer, 'comprobante.jpg'), {
                caption: view.text,
                parse_mode: 'HTML',
                reply_markup: view.keyboard
              });
              sentWithPhoto = true;
            }
          } catch {
            sentWithPhoto = false;
          }
        }

        if (!sentWithPhoto) {
          await ctx.reply(view.text, {
            parse_mode: 'HTML',
            reply_markup: view.keyboard
          });
        }
      }
    } catch (err: any) {
      await ctx.reply(`⚠️ Error consultando comprobantes: ${err.message}`);
    }
  }

  // 🔒 Middleware de autorización comercial (Multi-tenant Guard)
  bot.use(async (ctx, next) => {
    const text = ctx.message?.text || '';
    if (text.startsWith('/start') || text.startsWith('/activar') || text.startsWith('/admin')) {
      return next();
    }

    if (ctx.callbackQuery?.data?.startsWith('saas_')) {
      return next();
    }

    const userId = ctx.from?.id;
    if (userId) {
      if (accessStore.isSuperadmin(userId)) {
        if (!accessStore.getMembership(userId)) {
          accessStore.setMembership({
            telegramUserId: userId,
            tenantId: 'jaguares',
            role: 'owner',
            firstName: ctx.from?.first_name || 'Admin Maestro',
            username: ctx.from?.username ? `@${ctx.from.username}` : undefined,
            linkedAt: new Date().toISOString(),
            status: 'active'
          });
        }
        return next();
      }

      if (!accessStore.getMembership(userId)) {
        if (ctx.callbackQuery) {
          await ctx.answerCallbackQuery({
            text: '🔒 Acceso restringido. Se requiere vincular tu cuenta con /activar.',
            show_alert: true
          });
          return;
        }

        await ctx.reply(
          `🔒 <b>Acceso Restringido · Bot Empresarial</b>\n\n` +
            `Tu cuenta de Telegram aún no está vinculada a ningún negocio o escuela activa.\n\n` +
            `👉 <b>Si ya tienes tu código de activación:</b>\n` +
            `Escribe: <code>/activar TU_CODIGO</code>\n\n` +
            `👉 <b>Si deseas contratar este servicio:</b>\n` +
            `Comunícate con administración para habilitar tu acceso comercial.`,
          { parse_mode: 'HTML' }
        );
        return;
      }
    }

    return next();
  });

  // /start
  bot.command('start', async (ctx) => {
    clearChatHistory(ctx.chat.id);
    const from = ctx.from;
    if (!from) return;
    const userId = from.id;

    const payload = ctx.match?.trim();

    if (payload) {
      const res = accessStore.consumeActivationCode(
        payload,
        userId,
        from.first_name || 'Usuario',
        from.username ? `@${from.username}` : undefined
      );

      if (res.success && res.tenant) {
        const welcomeText =
          `🎉 <b>¡Bienvenido, ${from.first_name}!</b>\n\n` +
          `Tu cuenta de Telegram ha sido vinculada exitosamente a:\n` +
          `🏢 <b>${res.tenant.name}</b>\n` +
          `👑 Rol asignado: <b>${res.role?.toUpperCase()}</b>\n` +
          `✨ Plan: <b>${res.tenant.plan.toUpperCase()}</b>\n\n` +
          `Ya tienes acceso total para consultar métricas, alumnos, finanzas, comprobantes y cobranzas.\n\n` +
          `👇 Escribe cualquier consulta o usa los botones directos del menú:`;

        await ctx.reply(welcomeText, {
          parse_mode: 'HTML',
          reply_markup: getMainKeyboard()
        });
        return;
      } else {
        await ctx.reply(
          `⚠️ <b>No se pudo activar el acceso:</b>\n${res.message}\n\n` +
            `Si necesitas un código nuevo o renovar tu suscripción, contáctanos.`,
          { parse_mode: 'HTML' }
        );
        return;
      }
    }

    const membership = accessStore.getMembership(userId);
    if (!membership) {
      await ctx.reply(
        `🔒 <b>Acceso Privado · Bot Empresarial</b>\n\n` +
          `Hola ${from.first_name}. Este es un servicio exclusivo de gestión para clientes autorizados.\n\n` +
          `👉 <b>¿Ya tienes tu código de activación?</b>\n` +
          `Escribe: <code>/activar TU_CODIGO</code>\n\n` +
          `👉 <b>¿Deseas contratar este bot para tu negocio?</b>\n` +
          `Contáctanos para habilitar una suscripción para tu empresa.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const tenant = accessStore.getTenant(membership.tenantId);
    const tenantName = tenant?.name || 'Tu Empresa';

    const text =
      `👋 ¡Hola ${from.first_name}! Bienvenido a tu <b>Asistente de Gestión · ${tenantName}</b>.\n\n` +
      `Puedes consultarme métricas, buscar alumnos con WhatsApp de cobranza o ver comprobantes de pago.\n\n` +
      `📌 <b>Ejemplos de preguntas:</b>\n` +
      `• <i>"Buscar Huamani"</i> (o escribe su DNI)\n` +
      `• <i>"Ver comprobantes"</i>\n` +
      `• <i>"¿Cómo está la escuela?"</i>\n` +
      `• <i>"¿Cuánto hemos cobrado este mes?"</i>\n` +
      `• <i>"Envíame la lista en Excel"</i>\n\n` +
      `👇 O usa los botones directos del menú:`;

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: getMainKeyboard()
    });
  });

  // /activar <codigo>
  bot.command('activar', async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const userId = from.id;

    const code = ctx.match?.trim();
    if (!code) {
      await ctx.reply(
        `ℹ️ <b>¿Cómo activar tu cuenta?</b>\n\n` +
          `Debes ingresar el comando junto con tu código comercial de activación.\n` +
          `Ejemplo: <code>/activar ACT-JAG-1234</code>`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    const res = accessStore.consumeActivationCode(
      code,
      userId,
      from.first_name || 'Usuario',
      from.username ? `@${from.username}` : undefined
    );

    if (res.success && res.tenant) {
      await ctx.reply(
        `🎉 <b>¡Acceso Comercial Activado con Éxito!</b>\n\n` +
          `Tu cuenta quedó vinculada a <b>${res.tenant.name}</b> como <b>${res.role?.toUpperCase()}</b>.\n\n` +
          `Escribe /menu o haz tu primera pregunta para comenzar.`,
        {
          parse_mode: 'HTML',
          reply_markup: getMainKeyboard()
        }
      );
    } else {
      await ctx.reply(`⚠️ <b>Error de activación:</b>\n${res.message}`, { parse_mode: 'HTML' });
    }
  });

  // /menu
  bot.command('menu', async (ctx) => {
    clearChatHistory(ctx.chat.id);
    const userId = ctx.from?.id;
    let kb = getMainKeyboard();
    if (userId && accessStore.isSuperadmin(userId)) {
      kb = new InlineKeyboard(kb.inline_keyboard)
        .row()
        .text('👑 Panel Administrador Maestro', 'saas_back');
    }
    await ctx.reply('📋 <b>Menú de Consultas Rápidas</b>', {
      parse_mode: 'HTML',
      reply_markup: kb
    });
  });

  // /buscar <nombre o dni>
  bot.command('buscar', async (ctx) => {
    const term = ctx.match?.trim() || '';
    await handleStudentSearch(ctx, term);
  });

  // /comprobantes
  bot.command(['comprobantes', 'vouchers'], async (ctx) => {
    const filter = ctx.match?.trim() || undefined;
    await handleVouchersList(ctx, filter);
  });

  // /resumen
  bot.command('resumen', async (ctx) => {
    try {
      const period = resolvePeriod('este mes');
      const data = await jaguaresService.getOverview(period);
      await ctx.reply(renderOverview(data, period.label), { parse_mode: 'HTML' });
    } catch (err: any) {
      await ctx.reply(`⚠️ Error al consultar resumen: ${err.message}`);
    }
  });

  // /alumnos
  bot.command('alumnos', async (ctx) => {
    try {
      const data = await jaguaresService.getStudentCounts();
      await ctx.reply(renderStudentCounts(data), { parse_mode: 'HTML' });
    } catch (err: any) {
      await ctx.reply(`⚠️ Error al consultar alumnos: ${err.message}`);
    }
  });

  // /ingresos
  bot.command('ingresos', async (ctx) => {
    try {
      const period = resolvePeriod('este mes');
      const data = await jaguaresService.getIncomeSummary(period);
      await ctx.reply(renderIncomeSummary(data), { parse_mode: 'HTML' });
    } catch (err: any) {
      await ctx.reply(`⚠️ Error al consultar ingresos: ${err.message}`);
    }
  });

  // /deudas
  bot.command('deudas', async (ctx) => {
    try {
      const period = resolvePeriod('este mes');
      const data = await jaguaresService.getDebtSummary(period);
      await ctx.reply(renderDebtSummary(data), { parse_mode: 'HTML' });
    } catch (err: any) {
      await ctx.reply(`⚠️ Error al consultar deudas: ${err.message}`);
    }
  });

  // /deudores
  bot.command('deudores', async (ctx) => {
    try {
      const period = resolvePeriod('este mes');
      const data = await jaguaresService.getPendingDebtors(period, 10);
      await ctx.reply(renderPendingDebtors(data, period.label), { parse_mode: 'HTML' });
    } catch (err: any) {
      await ctx.reply(`⚠️ Error al consultar lista de deudores: ${err.message}`);
    }
  });

  // /cupos
  bot.command('cupos', async (ctx) => {
    try {
      const data = await jaguaresService.getCapacity();
      await ctx.reply(renderCapacity(data), { parse_mode: 'HTML' });
    } catch (err: any) {
      await ctx.reply(`⚠️ Error al consultar cupos: ${err.message}`);
    }
  });

  // /excel
  bot.command('excel', async (ctx) => {
    await ctx.reply('📊 <b>Centro de Descargas en Excel (.xlsx)</b>\n\nSelecciona el reporte que deseas exportar:', {
      parse_mode: 'HTML',
      reply_markup: getExcelKeyboard()
    });
  });

  // /notificaciones
  bot.command('notificaciones', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;
    const view = getNotificationsView(userId);
    await ctx.reply(view.text, {
      parse_mode: 'HTML',
      reply_markup: view.keyboard
    });
  });

  // /ayuda
  bot.command(['ayuda', 'help'], async (ctx) => {
    const helpText =
      `ℹ️ <b>Guía de Consultas para Escuela Jaguares</b>\n\n` +
      `Puedes escribir de forma natural o usar la barra <b>/</b> para ver todos los comandos directos:\n\n` +
      `🔍 <b>Búsqueda de Alumno con WhatsApp:</b>\n` +
      `• <code>/buscar Huamani</code> o escribe un DNI de 8 dígitos.\n\n` +
      `📸 <b>Comprobantes y Vouchers:</b>\n` +
      `• <code>/comprobantes</code> o <i>"ver vouchers de pago"</i>\n\n` +
      `🎓 <b>Resumen Ejecutivo:</b>\n` +
      `• <code>/resumen</code> o <i>"¿Cómo va la escuela?"</i>\n\n` +
      `👥 <b>Alumnos y Disciplinas:</b>\n` +
      `• <code>/alumnos</code> o <i>"¿Cuántos alumnos hay en fútbol?"</i>\n\n` +
      `💰 <b>Finanzas e Ingresos:</b>\n` +
      `• <code>/ingresos</code> o <i>"¿Cuánto dinero hemos cobrado este mes?"</i>\n\n` +
      `📋 <b>Deudas y Cobranzas:</b>\n` +
      `• <code>/deudas</code> o <code>/deudores</code>\n\n` +
      `📊 <b>Archivos Excel:</b>\n` +
      `• <code>/excel</code> o <i>"Envíame la lista en Excel"</i>\n\n` +
      `⏰ <b>Alertas y Reporte Matutino:</b>\n` +
      `• <code>/notificaciones</code> para configurar qué recibir y la hora.`;

    await ctx.reply(helpText, { parse_mode: 'HTML' });
  });

  // --- CALLBACKS DEL MENÚ PRINCIPAL ---
  bot.callbackQuery('action_overview', async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      const period = resolvePeriod('este mes');
      const data = await jaguaresService.getOverview(period);
      await ctx.reply(renderOverview(data, period.label), { parse_mode: 'HTML' });
    } catch (err: any) {
      await ctx.reply(`⚠️ Error al consultar resumen: ${err.message}`);
    }
  });

  bot.callbackQuery('action_students', async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      const data = await jaguaresService.getStudentCounts();
      await ctx.reply(renderStudentCounts(data), { parse_mode: 'HTML' });
    } catch (err: any) {
      await ctx.reply(`⚠️ Error al consultar alumnos: ${err.message}`);
    }
  });

  bot.callbackQuery('action_income', async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      const period = resolvePeriod('este mes');
      const data = await jaguaresService.getIncomeSummary(period);
      await ctx.reply(renderIncomeSummary(data), { parse_mode: 'HTML' });
    } catch (err: any) {
      await ctx.reply(`⚠️ Error al consultar ingresos: ${err.message}`);
    }
  });

  bot.callbackQuery('action_debt', async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      const period = resolvePeriod('este mes');
      const data = await jaguaresService.getDebtSummary(period);
      await ctx.reply(renderDebtSummary(data), { parse_mode: 'HTML' });
    } catch (err: any) {
      await ctx.reply(`⚠️ Error al consultar deudas: ${err.message}`);
    }
  });

  bot.callbackQuery('action_debtors', async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      const period = resolvePeriod('este mes');
      const data = await jaguaresService.getPendingDebtors(period, 10);
      await ctx.reply(renderPendingDebtors(data, period.label), { parse_mode: 'HTML' });
    } catch (err: any) {
      await ctx.reply(`⚠️ Error al consultar lista de deudores: ${err.message}`);
    }
  });

  bot.callbackQuery('action_capacity', async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      const data = await jaguaresService.getCapacity();
      await ctx.reply(renderCapacity(data), { parse_mode: 'HTML' });
    } catch (err: any) {
      await ctx.reply(`⚠️ Error al consultar capacidad: ${err.message}`);
    }
  });

  bot.callbackQuery('action_prompt_search', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply(
      `🔍 <b>Búsqueda de Alumnos</b>\n\n` +
        `Escribe el nombre, apellido o DNI del alumno.\n` +
        `Ejemplo: <code>/buscar Huamani</code> o simplemente escribe <code>74859612</code>`,
      { parse_mode: 'HTML' }
    );
  });

  bot.callbackQuery('action_vouchers', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleVouchersList(ctx);
  });

  bot.callbackQuery('action_back_menu', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('📋 <b>Menú de Consultas Rápidas</b>', {
      parse_mode: 'HTML',
      reply_markup: getMainKeyboard()
    });
  });

  // --- CALLBACK VER ALUMNO ESPECÍFICO ---
  bot.callbackQuery(/^student_view_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const alumnoId = parseInt(ctx.match[1], 10);
    try {
      const students = await jaguaresService.searchStudents(alumnoId.toString(), 1);
      if (students.length > 0) {
        const view = renderStudentDetail(students[0]);
        await ctx.reply(view.text, {
          parse_mode: 'HTML',
          reply_markup: view.keyboard
        });
      } else {
        await ctx.reply('⚠️ No se encontró la ficha del alumno.');
      }
    } catch (err: any) {
      await ctx.reply(`⚠️ Error consultando ficha: ${err.message}`);
    }
  });

  // --- CALLBACK VER VOUCHER DE UN ALUMNO ---
  bot.callbackQuery(/^voucher_view_(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: '📸 Cargando voucher...' });
    const alumnoId = parseInt(ctx.match[1], 10);
    await handleVouchersList(ctx, alumnoId.toString());
  });

  // --- CALLBACKS DE EXCEL ---
  bot.callbackQuery('excel_menu', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply('📊 <b>Centro de Descargas en Excel (.xlsx)</b>\n\nSelecciona el reporte que deseas exportar:', {
      parse_mode: 'HTML',
      reply_markup: getExcelKeyboard()
    });
  });

  bot.callbackQuery('excel_dl_debtors', async (ctx) => {
    await ctx.answerCallbackQuery({ text: '⏳ Generando Excel de deudores...' });
    try {
      const buffer = await generateDebtorsExcelBuffer('este mes');
      await ctx.replyWithDocument(new InputFile(buffer, 'Deudores_Jaguares.xlsx'), {
        caption: '📑 <b>Reporte Oficial de Deudores de Mensualidad</b>\nGenerado en tiempo real desde la base de datos.',
        parse_mode: 'HTML'
      });
    } catch (err: any) {
      await ctx.reply(`⚠️ Error generando Excel: ${err.message}`);
    }
  });

  bot.callbackQuery('excel_dl_students', async (ctx) => {
    await ctx.answerCallbackQuery({ text: '⏳ Generando padrón de alumnos...' });
    try {
      const buffer = await generateStudentsExcelBuffer();
      await ctx.replyWithDocument(new InputFile(buffer, 'Padron_Alumnos_Jaguares.xlsx'), {
        caption: '👥 <b>Padrón General de Alumnos Inscritos</b>\nGenerado en tiempo real desde la base de datos.',
        parse_mode: 'HTML'
      });
    } catch (err: any) {
      await ctx.reply(`⚠️ Error generando Excel: ${err.message}`);
    }
  });

  bot.callbackQuery('excel_dl_capacity', async (ctx) => {
    await ctx.answerCallbackQuery({ text: '⏳ Generando reporte de cupos...' });
    try {
      const buffer = await generateCapacityExcelBuffer();
      await ctx.replyWithDocument(new InputFile(buffer, 'Horarios_Cupos_Jaguares.xlsx'), {
        caption: '🏟️ <b>Estado y Capacidad de Horarios</b>\nGenerado en tiempo real desde la base de datos.',
        parse_mode: 'HTML'
      });
    } catch (err: any) {
      await ctx.reply(`⚠️ Error generando Excel: ${err.message}`);
    }
  });

  // --- CALLBACKS DE NOTIFICACIONES / REPORTES AUTOMÁTICOS ---
  bot.callbackQuery('notif_menu', async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    const view = getNotificationsView(userId);
    await ctx.reply(view.text, {
      parse_mode: 'HTML',
      reply_markup: view.keyboard
    });
  });

  bot.callbackQuery('notif_tog_students', async (ctx) => {
    const opts = accessStore.toggleNotificationOption(ctx.from.id, 'includeStudents');
    await ctx.answerCallbackQuery({ text: opts.includeStudents ? '👥 Alumnos: Activado' : '👥 Alumnos: Omitido' });
    const view = getNotificationsView(ctx.from.id);
    await ctx.editMessageText(view.text, { parse_mode: 'HTML', reply_markup: view.keyboard });
  });

  bot.callbackQuery('notif_tog_income', async (ctx) => {
    const opts = accessStore.toggleNotificationOption(ctx.from.id, 'includeIncome');
    await ctx.answerCallbackQuery({ text: opts.includeIncome ? '💰 Ingresos: Activado' : '💰 Ingresos: Omitido' });
    const view = getNotificationsView(ctx.from.id);
    await ctx.editMessageText(view.text, { parse_mode: 'HTML', reply_markup: view.keyboard });
  });

  bot.callbackQuery('notif_tog_debts', async (ctx) => {
    const opts = accessStore.toggleNotificationOption(ctx.from.id, 'includeDebts');
    await ctx.answerCallbackQuery({ text: opts.includeDebts ? '🚨 Cobranzas: Activado' : '🚨 Cobranzas: Omitido' });
    const view = getNotificationsView(ctx.from.id);
    await ctx.editMessageText(view.text, { parse_mode: 'HTML', reply_markup: view.keyboard });
  });

  bot.callbackQuery('notif_tog_capacity', async (ctx) => {
    const opts = accessStore.toggleNotificationOption(ctx.from.id, 'includeCapacity');
    await ctx.answerCallbackQuery({ text: opts.includeCapacity ? '🏟️ Cupos: Activado' : '🏟️ Cupos: Omitido' });
    const view = getNotificationsView(ctx.from.id);
    await ctx.editMessageText(view.text, { parse_mode: 'HTML', reply_markup: view.keyboard });
  });

  bot.callbackQuery('notif_tog_newstudents', async (ctx) => {
    const opts = accessStore.toggleNotificationOption(ctx.from.id, 'includeNewStudents');
    await ctx.answerCallbackQuery({ text: opts.includeNewStudents ? '🆕 Nuevos Alumnos: Activado' : '🆕 Nuevos Alumnos: Omitido' });
    const view = getNotificationsView(ctx.from.id);
    await ctx.editMessageText(view.text, { parse_mode: 'HTML', reply_markup: view.keyboard });
  });

  bot.callbackQuery('notif_pick_hour', async (ctx) => {
    await ctx.answerCallbackQuery();
    const view = getHourSelectionView(ctx.from.id);
    await ctx.editMessageText(view.text, { parse_mode: 'HTML', reply_markup: view.keyboard });
  });

  bot.callbackQuery('notif_menu_edit', async (ctx) => {
    await ctx.answerCallbackQuery();
    const view = getNotificationsView(ctx.from.id);
    await ctx.editMessageText(view.text, { parse_mode: 'HTML', reply_markup: view.keyboard });
  });

  bot.callbackQuery(/^notif_set_(\d\d:\d\d)$/, async (ctx) => {
    const hour = ctx.match[1];
    const userId = ctx.from.id;
    accessStore.updateDigestSettings(userId, true, hour);
    await ctx.answerCallbackQuery({ text: `✅ Horario configurado a las ${hour}` });
    const view = getNotificationsView(userId);
    await ctx.editMessageText(view.text, {
      parse_mode: 'HTML',
      reply_markup: view.keyboard
    });
  });

  bot.callbackQuery('notif_enable', async (ctx) => {
    const userId = ctx.from.id;
    accessStore.updateDigestSettings(userId, true);
    await ctx.answerCallbackQuery({ text: '🔔 Notificaciones activadas' });
    const view = getNotificationsView(userId);
    await ctx.editMessageText(view.text, {
      parse_mode: 'HTML',
      reply_markup: view.keyboard
    });
  });

  bot.callbackQuery('notif_disable', async (ctx) => {
    const userId = ctx.from.id;
    accessStore.updateDigestSettings(userId, false);
    await ctx.answerCallbackQuery({ text: '🔕 Notificaciones pausadas' });
    const view = getNotificationsView(userId);
    await ctx.editMessageText(view.text, {
      parse_mode: 'HTML',
      reply_markup: view.keyboard
    });
  });

  bot.callbackQuery('notif_test_now', async (ctx) => {
    await ctx.answerCallbackQuery({ text: '🚀 Generando reporte personalizado de prueba...' });
    try {
      await sendDailyDigestToUser(bot, ctx.from.id);
    } catch (err: any) {
      await ctx.reply(`⚠️ Error al generar reporte de prueba: ${err.message}`);
    }
  });

  // Procesamiento unificado de consultas en lenguaje natural (texto o voz)
  async function handleNaturalLanguageQuery(ctx: any, rawText: string) {
    const chatId = ctx.chat.id;
    const history = getChatHistory(chatId);

    const norm = rawText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // 1. DNI directo (8 dígitos)
    if (/^\d{8}$/.test(rawText)) {
      await handleStudentSearch(ctx, rawText);
      return;
    }

    // 2. Búsqueda explícita de alumno por texto libre: "buscar huamani", "ficha de perez", "datos de huamani"
    if (
      norm.startsWith('buscar ') ||
      norm.startsWith('busca ') ||
      norm.startsWith('ficha de ') ||
      norm.startsWith('datos de ') ||
      norm.startsWith('alumno ')
    ) {
      const query = rawText.replace(/^(buscar|busca|ficha de|datos de|alumno)\s+/i, '').trim();
      await handleStudentSearch(ctx, query);
      return;
    }

    // 3. Consulta de Comprobantes o Vouchers en texto libre
    if (
      norm.includes('comprobante') ||
      norm.includes('voucher') ||
      norm.includes('yape') ||
      norm.includes('plin')
    ) {
      if (norm.includes('ver') || norm.includes('mostrar') || norm.includes('ultim') || norm.includes('foto') || norm.includes('lista')) {
        await handleVouchersList(ctx);
        return;
      }
    }

    // 4. Descargas de Excel en texto libre
    if (norm.includes('excel') || norm.includes('xlsx')) {
      if (norm.includes('deud') || norm.includes('pag') || norm.includes('cobran')) {
        await ctx.reply('⏳ Generando archivo Excel de deudores...');
        try {
          const buffer = await generateDebtorsExcelBuffer('este mes');
          await ctx.replyWithDocument(new InputFile(buffer, 'Deudores_Jaguares.xlsx'), {
            caption: '📑 <b>Reporte de Deudores de Mensualidad</b> (.xlsx)',
            parse_mode: 'HTML'
          });
          return;
        } catch (err: any) {
          await ctx.reply(`⚠️ Error al generar Excel: ${err.message}`);
          return;
        }
      }

      if (norm.includes('alumno') || norm.includes('inscrit') || norm.includes('padron')) {
        await ctx.reply('⏳ Generando padrón de alumnos en Excel...');
        try {
          const buffer = await generateStudentsExcelBuffer();
          await ctx.replyWithDocument(new InputFile(buffer, 'Padron_Alumnos_Jaguares.xlsx'), {
            caption: '👥 <b>Padrón de Alumnos</b> (.xlsx)',
            parse_mode: 'HTML'
          });
          return;
        } catch (err: any) {
          await ctx.reply(`⚠️ Error al generar Excel: ${err.message}`);
          return;
        }
      }

      if (norm.includes('cupo') || norm.includes('horario') || norm.includes('capacidad')) {
        await ctx.reply('⏳ Generando reporte de cupos en Excel...');
        try {
          const buffer = await generateCapacityExcelBuffer();
          await ctx.replyWithDocument(new InputFile(buffer, 'Horarios_Cupos_Jaguares.xlsx'), {
            caption: '🏟️ <b>Horarios y Cupos</b> (.xlsx)',
            parse_mode: 'HTML'
          });
          return;
        } catch (err: any) {
          await ctx.reply(`⚠️ Error al generar Excel: ${err.message}`);
          return;
        }
      }

      await ctx.reply('📊 <b>Descargas en Excel (.xlsx)</b>\n¿Cuál de estos reportes deseas descargar?', {
        parse_mode: 'HTML',
        reply_markup: getExcelKeyboard()
      });
      return;
    }

    // Seguimiento conversacional
    const isShortFollowUp =
      history.length > 0 &&
      /^(s[ií]|claro|por favor|ok|dale|vale|no|adelante|det[aá]llalo|det[aá]llalos|mu[eé]stralo|mu[eé]stralos|a ver)[.!]?$/i.test(
        rawText
      );

    let match = null;
    if (!isShortFollowUp) {
      match = routeMessage(rawText);
    }

    if (!match) {
      match = await routeMessageWithLLM(rawText, { history });
    }

    if (!match) {
      await ctx.reply(
        `No entendí del todo tu consulta 🤔\n\n` +
          `Puedo ayudarte con:\n` +
          `• 🔍 Buscar alumno: <code>/buscar Huamani</code> (o escribe su DNI)\n` +
          `• 📸 Ver comprobantes: <code>/comprobantes</code>\n` +
          `• 🎓 Resumen general: <i>"¿Cómo está la escuela?"</i>\n` +
          `• 👥 Alumnos: <i>"¿Cuántos alumnos hay en fútbol?"</i>\n` +
          `• 💰 Ingresos: <i>"¿Cuánto cobramos este mes?"</i>\n` +
          `• 📋 Deudas: <i>"¿Quiénes deben este mes?"</i>\n` +
          `• 📊 Excel: <i>"Envíame la lista en Excel"</i>\n\n` +
          `Escribe /menu o presiona la barra <b>/</b> para ver los accesos rápidos.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    try {
      switch (match.intent) {
        case 'general.greeting': {
          const name = ctx.from?.first_name || 'dueño/administrador';
          const reply = `👋 ¡Hola ${name}! ¿En qué puedo ayudarte hoy con la Escuela Jaguares?\n\n` +
            `Puedes preguntarme sobre alumnos, cobranzas, deudas, cupos o buscar alumnos con WhatsApp de cobranza:`;
          addChatMessage(chatId, 'user', rawText);
          addChatMessage(chatId, 'assistant', reply);
          await ctx.reply(reply, {
            parse_mode: 'HTML',
            reply_markup: getMainKeyboard()
          });
          break;
        }

        case 'general.direct_response': {
          const replyText = match.slots.directResponse || '¿En qué puedo ayudarte hoy?';
          addChatMessage(chatId, 'user', rawText);
          addChatMessage(chatId, 'assistant', replyText);
          const htmlFormatted = markdownToTelegramHtml(replyText);
          try {
            await ctx.reply(htmlFormatted, { parse_mode: 'HTML' });
          } catch (err: any) {
            console.warn('⚠️ Falló parse_mode HTML en Telegram, enviando limpio:', err.message);
            const plainFallback = replyText.replace(/\*\*/g, '').replace(/__/g, '');
            await ctx.reply(plainFallback);
          }
          break;
        }

        case 'general.help': {
          await ctx.reply(
            `Escribe tu pregunta, el DNI de un alumno o usa /menu para ver los botones rápidos.\nEjemplo: <code>/buscar Huamani</code>`,
            { parse_mode: 'HTML' }
          );
          break;
        }

        case 'general.menu': {
          clearChatHistory(chatId);
          await ctx.reply('📋 <b>Menú de opciones:</b>', {
            parse_mode: 'HTML',
            reply_markup: getMainKeyboard()
          });
          break;
        }

        case 'jag.overview': {
          const period = match.slots.period || resolvePeriod('este mes');
          const data = await jaguaresService.getOverview(period);
          const reply = renderOverview(data, period.label);
          addChatMessage(chatId, 'user', rawText);
          addChatMessage(chatId, 'assistant', reply);
          await ctx.reply(reply, { parse_mode: 'HTML' });
          break;
        }

        case 'jag.student_counts': {
          const data = await jaguaresService.getStudentCounts(match.slots.discipline);
          const reply = renderStudentCounts(data, match.slots.discipline);
          addChatMessage(chatId, 'user', rawText);
          addChatMessage(chatId, 'assistant', reply);
          await ctx.reply(reply, { parse_mode: 'HTML' });
          break;
        }

        case 'jag.income_summary': {
          const period = match.slots.period || resolvePeriod('este mes');
          const data = await jaguaresService.getIncomeSummary(period);
          const reply = renderIncomeSummary(data);
          addChatMessage(chatId, 'user', rawText);
          addChatMessage(chatId, 'assistant', reply);
          await ctx.reply(reply, { parse_mode: 'HTML' });
          break;
        }

        case 'jag.debt_summary': {
          const period = match.slots.period || resolvePeriod('este mes');
          const data = await jaguaresService.getDebtSummary(period);
          const reply = renderDebtSummary(data);
          addChatMessage(chatId, 'user', rawText);
          addChatMessage(chatId, 'assistant', reply);
          await ctx.reply(reply, { parse_mode: 'HTML' });
          break;
        }

        case 'jag.pending_payments': {
          const period = match.slots.period || resolvePeriod('este mes');
          const data = await jaguaresService.getPendingDebtors(period, 10);
          const reply = renderPendingDebtors(data, period.label);
          addChatMessage(chatId, 'user', rawText);
          addChatMessage(chatId, 'assistant', reply);
          await ctx.reply(reply, { parse_mode: 'HTML' });
          break;
        }

        case 'jag.enrollments': {
          const period = match.slots.period || resolvePeriod('este mes');
          const data = await jaguaresService.getEnrollments(period);
          const reply = renderEnrollments(data);
          addChatMessage(chatId, 'user', rawText);
          addChatMessage(chatId, 'assistant', reply);
          await ctx.reply(reply, { parse_mode: 'HTML' });
          break;
        }

        case 'jag.recent_students': {
          const students = await jaguaresService.getRecentStudents(5);
          const reply = renderRecentStudents(students);
          addChatMessage(chatId, 'user', rawText);
          addChatMessage(chatId, 'assistant', reply);
          await ctx.reply(reply, { parse_mode: 'HTML' });
          break;
        }

        case 'jag.capacity': {
          const data = await jaguaresService.getCapacity(match.slots.discipline);
          const reply = renderCapacity(data);
          addChatMessage(chatId, 'user', rawText);
          addChatMessage(chatId, 'assistant', reply);
          await ctx.reply(reply, { parse_mode: 'HTML' });
          break;
        }
      }
    } catch (error: any) {
      console.error('Error al procesar consulta:', error);
      await ctx.reply(`⚠️ Ocurrió un error al consultar los datos: ${error.message}`);
    }
  }

  // 1. Mensajes de texto libres
  bot.on('message:text', async (ctx) => {
    await handleNaturalLanguageQuery(ctx, ctx.message.text.trim());
  });

  // 2. Notas de voz o audios (Voice-to-Text con Whisper)
  bot.on(['message:voice', 'message:audio'], async (ctx) => {
    const hasVoiceKey = Boolean(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY);
    if (!hasVoiceKey) {
      await ctx.reply(
        '🎙️ <b>Nota de voz recibida</b>\n\n' +
          'Para activar la transcripción automática e inteligente de audios (Whisper), solo agrega tu clave <code>GROQ_API_KEY</code> u <code>OPENAI_API_KEY</code> en tu servidor.\n\n' +
          '💡 <i>Mientras tanto, puedes consultar escribiendo por texto.</i>',
        { parse_mode: 'HTML' }
      );
      return;
    }

    try {
      await ctx.replyWithChatAction('typing');
      const file = await ctx.getFile();
      const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      const transcription = await transcribeAudioUrl(fileUrl);

      if (!transcription || transcription.trim().length === 0) {
        await ctx.reply('⚠️ No pude entender el audio con claridad. Intenta enviar otra nota de voz más clara o escribir tu consulta.');
        return;
      }

      await ctx.reply(`🎙️ <i>«${escapeHtml(transcription)}»</i>`, { parse_mode: 'HTML' });
      await handleNaturalLanguageQuery(ctx, transcription);
    } catch (err: any) {
      console.error('Error al transcribir nota de voz:', err);
      await ctx.reply(`⚠️ No se pudo procesar la nota de voz: ${err.message}`);
    }
  });

  return bot;
}
