import { Bot, InlineKeyboard } from 'grammy';
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
  markdownToTelegramHtml
} from '../rendering/jaguares-templates.js';
import { resolvePeriod } from '../date-resolver/date-resolver.js';
import { getChatHistory, addChatMessage, clearChatHistory } from './conversation-memory.js';
import { accessStore } from '../auth/access-store.js';
import { registerAdminPanel } from './admin-panel.js';

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
      .text('🏟️ Cupos y Horarios', 'action_capacity');
  }

  // 🔒 Middleware de autorización comercial (Multi-tenant Guard)
  bot.use(async (ctx, next) => {
    const text = ctx.message?.text || '';
    // Permitir libremente comandos públicos de bienvenida, activación y panel maestro
    if (text.startsWith('/start') || text.startsWith('/activar') || text.startsWith('/admin')) {
      return next();
    }

    if (ctx.callbackQuery?.data?.startsWith('saas_')) {
      return next();
    }

    const userId = ctx.from?.id;
    if (userId) {
      // 👑 El Creador / Superadmin Maestro tiene acceso total ilimitado y queda auto-vinculado
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

      // Para el resto de usuarios, verificar si tienen membresía activa
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

  // /start (con soporte para deep-link de activación: t.me/Bot?start=CODIGO)
  bot.command('start', async (ctx) => {
    clearChatHistory(ctx.chat.id);
    const from = ctx.from;
    if (!from) return;
    const userId = from.id;

    const payload = ctx.match?.trim(); // parámetro después de /start, ej: ACT-JAG-XXXX

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
          `Ya tienes acceso total para consultar métricas, alumnos, finanzas y horarios en tiempo real.\n\n` +
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

    // Si no pasó payload, verificar si ya tiene membresía activa
    const membership = accessStore.getMembership(userId);
    if (!membership) {
      await ctx.reply(
        `🔒 <b>Acceso Privado · Bot Empresarial</b>\n\n` +
          `Hola ${from.first_name}. Este es un servicio exclusivo de gestión para clientes autorizados.\n\n` +
          `👉 <b>¿Ya tienes tu código de activación?</b>\n` +
          `Escribe: <code>/activar TU_CODIGO</code>\n` +
          `<i>(O haz clic directamente en el enlace de invitación que te enviamos)</i>\n\n` +
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
      `Puedes consultarme métricas, alumnos, ingresos y cobranzas en lenguaje natural.\n\n` +
      `📌 <b>Ejemplos de preguntas:</b>\n` +
      `• <i>"¿Cómo está la escuela?"</i>\n` +
      `• <i>"¿Cuántos alumnos tenemos?"</i>\n` +
      `• <i>"¿Cuánto hemos cobrado este mes?"</i>\n` +
      `• <i>"¿Quiénes deben este mes?"</i>\n` +
      `• <i>"¿Cómo están los cupos?"</i>\n\n` +
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

  // /ayuda
  bot.command(['ayuda', 'help'], async (ctx) => {
    const helpText =
      `ℹ️ <b>Guía de Consultas para Escuela Jaguares</b>\n\n` +
      `Puedes escribirme de forma natural como hablar con un asistente. Respondo sobre:\n\n` +
      `🎓 <b>Resumen Ejecutivo:</b>\n` +
      `• <i>"¿Cómo va la escuela?"</i>\n` +
      `• <i>"resumen del mes"</i>\n\n` +
      `👥 <b>Alumnos y Disciplinas:</b>\n` +
      `• <i>"¿Cuántos alumnos activos tenemos?"</i>\n` +
      `• <i>"¿Cuántos alumnos hay en fútbol / vóley / básquet?"</i>\n` +
      `• <i>"¿Cuántos alumnos nuevos entraron este mes?"</i>\n\n` +
      `💰 <b>Finanzas e Ingresos:</b>\n` +
      `• <i>"¿Cuánto dinero hemos cobrado este mes?"</i>\n` +
      `• <i>"¿Cuánto cobramos en septiembre?"</i>\n\n` +
      `📋 <b>Deudas y Pagos Pendientes (pagos_mensuales):</b>\n` +
      `• <i>"¿Cuánto nos deben?"</i>\n` +
      `• <i>"¿Cuánto falta por cobrar?"</i>\n` +
      `• <i>"¿Quiénes deben este mes?"</i>\n\n` +
      `🏟️ <b>Cupos y Capacidad:</b>\n` +
      `• <i>"¿Cómo están los cupos de fútbol?"</i>\n` +
      `• <i>"¿Qué horarios tienen cupos disponibles?"</i>`;

    await ctx.reply(helpText, { parse_mode: 'HTML' });
  });

  // Callbacks de los botones del menú
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

  // Mensajes de texto libres en lenguaje natural
  bot.on('message:text', async (ctx) => {
    const rawText = ctx.message.text;
    const chatId = ctx.chat.id;
    const history = getChatHistory(chatId);

    // Si hay conversación previa y el mensaje es de seguimiento breve (ej: "si", "ok", "claro", "por favor", "detallalo", "quienes son"),
    // omitimos el enrutador de reglas estáticas para que el LLM resuelva en base al hilo de la conversación.
    const isShortFollowUp =
      history.length > 0 &&
      /^(s[ií]|claro|por favor|ok|dale|vale|no|adelante|det[aá]llalo|det[aá]llalos|mu[eé]stralo|mu[eé]stralos|a ver)[.!]?$/i.test(
        rawText.trim()
      );

    let match = null;
    if (!isShortFollowUp) {
      match = routeMessage(rawText);
    }

    // 2. Si no coincide con regla fija o es seguimiento conversacional, consultar con LLM pasando el historial
    if (!match) {
      match = await routeMessageWithLLM(rawText, { history });
    }

    if (!match) {
      await ctx.reply(
        `No entendí del todo tu consulta 🤔\n\n` +
          `Puedo responderte sobre:\n` +
          `• Resumen general: <i>"¿Cómo está la escuela?"</i>\n` +
          `• Alumnos: <i>"¿Cuántos alumnos hay en fútbol?"</i>\n` +
          `• Ingresos: <i>"¿Cuánto cobramos este mes?"</i>\n` +
          `• Deudas: <i>"¿Cuánto falta cobrar?"</i> o <i>"¿Quiénes deben?"</i>\n` +
          `• Cupos: <i>"¿Cómo están los cupos?"</i>\n\n` +
          `Escribe /menu para ver las opciones directas.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    try {
      switch (match.intent) {
        case 'general.greeting': {
          const name = ctx.from?.first_name || 'dueño/administrador';
          const reply = `👋 ¡Hola ${name}! ¿En qué puedo ayudarte hoy con la Escuela Jaguares?\n\n` +
            `Puedes preguntarme sobre alumnos, cobranzas, deudas o cupos:`;
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
            `Escribe tu pregunta o usa /menu para ver los botones rápidos.\nEjemplo: <i>"¿Cuánto hemos cobrado este mes?"</i>`,
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
  });

  return bot;
}
