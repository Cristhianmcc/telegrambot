import { Bot, InlineKeyboard } from 'grammy';
import { accessStore } from '../auth/access-store.js';

export function registerAdminPanel(bot: Bot): void {
  function getAdminMainKeyboard(): InlineKeyboard {
    return new InlineKeyboard()
      .text('👥 Clientes Vinculados', 'saas_clients')
      .text('➕ Generar Enlace de Venta', 'saas_gen_link')
      .row()
      .text('🔑 Códigos Pendientes', 'saas_codes')
      .text('🏢 Negocios / Tenants', 'saas_tenants')
      .row()
      .text('❌ Cerrar Panel', 'saas_close');
  }

  // Comando /admin
  bot.command('admin', async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const userId = from.id;

    if (!accessStore.isSuperadmin(userId)) {
      await ctx.reply('⛔ <b>Acceso denegado</b>\nEste comando es exclusivo para el administrador maestro.', {
        parse_mode: 'HTML'
      });
      return;
    }

    const text =
      `👑 <b>Panel de Control SaaS · Administrador Maestro</b>\n\n` +
      `¡Hola <b>${from.first_name}</b>! Bienvenido a tu panel de administración.\n` +
      `Desde aquí puedes monitorear tus ventas, generar enlaces para clientes y dar de baja usuarios en tiempo real:`;

    await ctx.reply(text, {
      parse_mode: 'HTML',
      reply_markup: getAdminMainKeyboard()
    });
  });

  // Callback: Ver clientes vinculados
  bot.callbackQuery('saas_clients', async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    if (!accessStore.isSuperadmin(userId)) return;

    const memberships = accessStore.listMemberships();
    if (memberships.length === 0) {
      const kb = new InlineKeyboard()
        .text('➕ Generar Enlace para Nuevo Cliente', 'saas_gen_link')
        .row()
        .text('🔙 Volver al Menú Admin', 'saas_back');
      await ctx.editMessageText('👥 <b>Clientes Vinculados:</b>\n\n<i>Aún no tienes ningún cliente vinculado al bot.</i>', {
        parse_mode: 'HTML',
        reply_markup: kb
      });
      return;
    }

    let text = `👥 <b>Clientes y Usuarios Vinculados (${memberships.length}):</b>\n\n`;
    const kb = new InlineKeyboard();

    for (const m of memberships) {
      const tenant = accessStore.getTenant(m.tenantId);
      const tenantName = tenant?.name || m.tenantId;
      const statusEmoji = m.status === 'active' ? '🟢' : '🔴';
      text += `${statusEmoji} <b>${m.firstName}</b> (${m.username || 'sin @'})\n`;
      text += `   🏢 Negocio: <b>${tenantName}</b>\n`;
      text += `   👑 Rol: <code>${m.role}</code> | ID: <code>${m.telegramUserId}</code>\n\n`;

      if (m.status === 'active') {
        kb.text(`🔴 Dar de baja a ${m.firstName}`, `saas_revoke_${m.telegramUserId}`).row();
      }
    }

    kb.text('🔙 Volver al Menú Admin', 'saas_back');

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: kb
    });
  });

  // Callback: Revocar acceso a un cliente
  bot.callbackQuery(/^saas_revoke_(\d+)$/, async (ctx) => {
    const targetUserId = parseInt(ctx.match[1], 10);
    const userId = ctx.from.id;
    if (!accessStore.isSuperadmin(userId)) return;

    const success = accessStore.revokeMembership(targetUserId);
    if (success) {
      await ctx.answerCallbackQuery({ text: '✅ Acceso revocado correctamente.', show_alert: true });
    } else {
      await ctx.answerCallbackQuery({ text: '⚠️ No se encontró la membresía.', show_alert: true });
    }

    // Volver a cargar la lista actualizada
    const memberships = accessStore.listMemberships();
    let text = `👥 <b>Clientes y Usuarios Vinculados (${memberships.length}):</b>\n\n`;
    const kb = new InlineKeyboard();

    for (const m of memberships) {
      const tenant = accessStore.getTenant(m.tenantId);
      const tenantName = tenant?.name || m.tenantId;
      const statusEmoji = m.status === 'active' ? '🟢' : '🔴';
      text += `${statusEmoji} <b>${m.firstName}</b> (${m.username || 'sin @'})\n`;
      text += `   🏢 Negocio: <b>${tenantName}</b>\n`;
      text += `   👑 Rol: <code>${m.role}</code> | ID: <code>${m.telegramUserId}</code>\n\n`;

      if (m.status === 'active') {
        kb.text(`🔴 Dar de baja a ${m.firstName}`, `saas_revoke_${m.telegramUserId}`).row();
      }
    }
    kb.text('🔙 Volver al Menú Admin', 'saas_back');

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: kb
    });
  });

  // Callback: Generar Enlace de Venta
  bot.callbackQuery('saas_gen_link', async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    if (!accessStore.isSuperadmin(userId)) return;

    const tenants = accessStore.listTenants();
    const kb = new InlineKeyboard();

    for (const t of tenants) {
      kb.text(`⭐ ${t.name}`, `saas_create_for_${t.id}`).row();
    }
    kb.text('🔙 Volver al Menú Admin', 'saas_back');

    await ctx.editMessageText(
      '➕ <b>Generar Enlace de Activación</b>\n\n¿Para qué negocio deseas generar la licencia comercial?',
      {
        parse_mode: 'HTML',
        reply_markup: kb
      }
    );
  });

  // Callback: Crear enlace para un tenant específico
  bot.callbackQuery(/^saas_create_for_(.+)$/, async (ctx) => {
    const tenantId = ctx.match[1];
    const userId = ctx.from.id;
    if (!accessStore.isSuperadmin(userId)) return;

    const tenant = accessStore.getTenant(tenantId);
    if (!tenant) {
      await ctx.answerCallbackQuery({ text: 'Negocio no encontrado', show_alert: true });
      return;
    }

    const botUsername = ctx.me.username || process.env.TELEGRAM_BOT_USERNAME || 'Monterrial_bot';
    const codeObj = accessStore.createActivationCode(tenantId, 'owner', 7, `Creado desde bot por admin`);
    const deepLink = `https://t.me/${botUsername}?start=${codeObj.code}`;
    const shareWhatsappText = encodeURIComponent(
      `¡Hola! Aquí tienes tu acceso exclusivo al Bot de Gestión de ${tenant.name}. Haz clic en el siguiente enlace y presiona "Iniciar":\n${deepLink}`
    );
    const whatsappUrl = `https://wa.me/?text=${shareWhatsappText}`;

    const text =
      `🎉 <b>¡Enlace de Activación Creado!</b>\n\n` +
      `🏢 Negocio: <b>${tenant.name}</b>\n` +
      `👑 Rol: <b>DUEÑO (OWNER)</b>\n` +
      `🔑 Código: <code>${codeObj.code}</code>\n` +
      `⏳ Válido por: <b>7 días</b>\n\n` +
      `📲 <b>Enlace directo para tu cliente:</b>\n` +
      `${deepLink}\n\n` +
      `<i>Puedes reenviarle este mensaje o usar el botón de abajo para enviárselo directamente por WhatsApp.</i>`;

    const kb = new InlineKeyboard()
      .url('📲 Enviar por WhatsApp', whatsappUrl)
      .row()
      .text('➕ Generar Otro Enlace', 'saas_gen_link')
      .text('🔙 Volver al Menú Admin', 'saas_back');

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: kb
    });
  });

  // Callback: Códigos Pendientes
  bot.callbackQuery('saas_codes', async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    if (!accessStore.isSuperadmin(userId)) return;

    const codes = accessStore.listActivationCodes(true);
    if (codes.length === 0) {
      const kb = new InlineKeyboard()
        .text('➕ Generar Nuevo Enlace', 'saas_gen_link')
        .row()
        .text('🔙 Volver al Menú Admin', 'saas_back');

      await ctx.editMessageText(
        '🔑 <b>Códigos y Enlaces Pendientes:</b>\n\n<i>No hay códigos pendientes sin canjear actualmente.</i>',
        {
          parse_mode: 'HTML',
          reply_markup: kb
        }
      );
      return;
    }

    const botUsername = ctx.me.username || process.env.TELEGRAM_BOT_USERNAME || 'Monterrial_bot';
    let text = `🔑 <b>Códigos Pendientes de Canje (${codes.length}):</b>\n\n`;
    const kb = new InlineKeyboard();

    for (const c of codes) {
      const tenant = accessStore.getTenant(c.tenantId);
      const link = `https://t.me/${botUsername}?start=${c.code}`;
      text += `• <b>${c.code}</b> (${tenant?.name || c.tenantId})\n`;
      text += `  Enlace: ${link}\n`;
      text += `  Expira: ${new Date(c.expiresAt).toLocaleDateString('es-PE')}\n\n`;

      kb.text(`🗑️ Eliminar ${c.code}`, `saas_delcode_${c.code}`).row();
    }

    kb.text('🔙 Volver al Menú Admin', 'saas_back');

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: kb
    });
  });

  // Callback: Eliminar código pendiente
  bot.callbackQuery(/^saas_delcode_(.+)$/, async (ctx) => {
    const code = ctx.match[1];
    const userId = ctx.from.id;
    if (!accessStore.isSuperadmin(userId)) return;

    accessStore.revokeActivationCode(code);
    await ctx.answerCallbackQuery({ text: `Código ${code} eliminado.`, show_alert: true });

    // Recargar lista
    const codes = accessStore.listActivationCodes(true);
    const kb = new InlineKeyboard();
    let text = `🔑 <b>Códigos Pendientes de Canje (${codes.length}):</b>\n\n`;

    if (codes.length === 0) {
      text += '<i>No hay códigos pendientes.</i>';
    } else {
      const botUsername = ctx.me.username || process.env.TELEGRAM_BOT_USERNAME || 'Monterrial_bot';
      for (const c of codes) {
        const tenant = accessStore.getTenant(c.tenantId);
        const link = `https://t.me/${botUsername}?start=${c.code}`;
        text += `• <b>${c.code}</b> (${tenant?.name || c.tenantId})\n`;
        text += `  Enlace: ${link}\n\n`;
        kb.text(`🗑️ Eliminar ${c.code}`, `saas_delcode_${c.code}`).row();
      }
    }
    kb.text('🔙 Volver al Menú Admin', 'saas_back');

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: kb
    });
  });

  // Callback: Negocios registrados
  bot.callbackQuery('saas_tenants', async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    if (!accessStore.isSuperadmin(userId)) return;

    const tenants = accessStore.listTenants();
    let text = `🏢 <b>Negocios y Empresas Registradas (${tenants.length}):</b>\n\n`;

    for (const t of tenants) {
      text += `• <b>${t.name}</b>\n`;
      text += `  ID: <code>${t.id}</code> | Plan: <code>${t.plan.toUpperCase()}</code> | Estado: <b>${t.status.toUpperCase()}</b>\n\n`;
    }

    const kb = new InlineKeyboard().text('🔙 Volver al Menú Admin', 'saas_back');

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: kb
    });
  });

  // Callback: Volver al menú admin
  bot.callbackQuery('saas_back', async (ctx) => {
    await ctx.answerCallbackQuery();
    const userId = ctx.from.id;
    if (!accessStore.isSuperadmin(userId)) return;

    const text =
      `👑 <b>Panel de Control SaaS · Administrador Maestro</b>\n\n` +
      `Desde aquí puedes monitorear tus ventas, generar enlaces para clientes y dar de baja usuarios en tiempo real:`;

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: getAdminMainKeyboard()
    });
  });

  // Callback: Cerrar panel
  bot.callbackQuery('saas_close', async (ctx) => {
    await ctx.answerCallbackQuery();
    try {
      await ctx.deleteMessage();
    } catch {}
  });
}
