import cron from 'node-cron';
import { Bot, InlineKeyboard } from 'grammy';
import { DateTime } from 'luxon';
import mysql from 'mysql2/promise';
import { accessStore } from '../auth/access-store.js';
import { executeReadOnlyQuery, getColYear, getJaguaresPool } from '../connectors/jaguares/jaguares-db.js';
import { buildWhatsAppLink, escapeHtml } from '../rendering/jaguares-templates.js';

/**
 * Vigilante de pagos: detecta comprobantes nuevos en `pagos_mensuales` y avisa por Telegram.
 *
 * Jaguares ejecuta `fecha_pago = NOW()` tanto al insertar un pago nuevo como al
 * actualizar uno pendiente con su comprobante, así que basta con una "marca de agua"
 * sobre `fecha_pago`. La consulta es de solo lectura, usa LIMIT y normalmente devuelve 0 filas.
 */

let watermark: string | null = null; // 'YYYY-MM-DD HH:mm:ss' tal como lo guarda MySQL
const seenAtWatermark = new Set<number>(); // pago_id ya avisados con fecha == watermark
let running = false;
let hasNumeroOperacion: boolean | null = null; // no todas las BD tienen esta columna en pagos_mensuales

async function readMaxFechaPago(): Promise<string | null> {
  const rows = await executeReadOnlyQuery<mysql.RowDataPacket[]>(
    `SELECT DATE_FORMAT(MAX(fecha_pago), '%Y-%m-%d %H:%i:%s') AS maxf
       FROM pagos_mensuales
      WHERE comprobante_url IS NOT NULL AND TRIM(comprobante_url) != ''`
  );
  return rows[0]?.maxf ?? null;
}

export async function fetchNewPayments(since: string): Promise<mysql.RowDataPacket[]> {
  await getJaguaresPool(); // garantiza que ya se detectó la columna año/anio
  const colYear = getColYear();
  if (hasNumeroOperacion === null) {
    const cols = await executeReadOnlyQuery<mysql.RowDataPacket[]>("SHOW COLUMNS FROM pagos_mensuales LIKE 'numero_operacion'");
    hasNumeroOperacion = cols.length > 0;
  }
  const opCol = hasNumeroOperacion ? 'pm.numero_operacion' : 'NULL';
  return executeReadOnlyQuery<mysql.RowDataPacket[]>(
    `SELECT pm.pago_id,
            pm.fecha_pago,
            DATE_FORMAT(pm.fecha_pago, '%Y-%m-%d %H:%i:%s') AS fecha_raw,
            pm.mes, pm.\`${colYear}\` AS anio, pm.monto, pm.metodo_pago,
            ${opCol} AS numero_operacion, pm.comprobante_url,
            a.dni, a.apoderado,
            TRIM(CONCAT(a.nombres, ' ', a.apellido_paterno, ' ', IFNULL(a.apellido_materno, ''))) AS alumno,
            IFNULL(a.telefono_apoderado, IFNULL(a.telefono, '')) AS telefono
       FROM pagos_mensuales pm
       JOIN alumnos a ON a.alumno_id = pm.alumno_id
      WHERE pm.fecha_pago >= ?
        AND pm.comprobante_url IS NOT NULL AND TRIM(pm.comprobante_url) != ''
      ORDER BY pm.fecha_pago ASC, pm.pago_id ASC
      LIMIT 20`,
    [since]
  );
}

function buildAlert(r: mysql.RowDataPacket): { text: string; keyboard: InlineKeyboard } {
  const monto = Number(r.monto || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  let text = `🔔 <b>¡Nuevo pago registrado!</b> 🐆\n\n`;
  text += `👤 <b>Alumno:</b> ${escapeHtml(r.alumno || '')} (DNI: <code>${escapeHtml(r.dni || '')}</code>)\n`;
  text += `💰 <b>Monto:</b> <b>S/ ${monto}</b> · ${escapeHtml(String(r.mes || ''))} ${r.anio ?? ''}\n`;
  text += `💳 <b>Método:</b> ${escapeHtml(r.metodo_pago || 'Yape / Plin')}\n`;
  if (r.numero_operacion) {
    text += `🔢 <b>Nº Operación:</b> <code>${escapeHtml(String(r.numero_operacion))}</code>\n`;
  }

  let fechaTxt = '';
  if (r.fecha_pago) {
    fechaTxt = DateTime.fromJSDate(new Date(r.fecha_pago))
      .setZone('America/Lima')
      .toFormat('dd/MM/yyyy hh:mm a');
  }
  if (fechaTxt) text += `🕒 <b>Hora:</b> ${fechaTxt}\n`;
  text += `\n<i>Pendiente de verificación en el panel de Jaguares.</i>`;

  const kb = new InlineKeyboard();
  if (r.comprobante_url && /^https?:\/\//.test(r.comprobante_url)) {
    kb.url('🔗 Abrir Comprobante', r.comprobante_url).row();
  }
  const wa = buildWhatsAppLink(r.telefono || undefined, r.alumno || '', r.apoderado || undefined);
  if (wa) kb.url('💬 WhatsApp al Apoderado', wa);

  return { text, keyboard: kb };
}

async function tick(bot: Bot): Promise<void> {
  if (running) return; // evita solapamiento si la BD responde lento
  running = true;
  try {
    // Primera ejecución: fijar la marca sin avisar pagos antiguos
    if (watermark === null) {
      watermark = (await readMaxFechaPago()) ?? '1970-01-01 00:00:00';
      const existingAtWatermark = await fetchNewPayments(watermark);
      for (const r of existingAtWatermark) {
        seenAtWatermark.add(r.pago_id);
      }
      return;
    }

    const rows = await fetchNewPayments(watermark);
    const fresh = rows.filter((r) => !(r.fecha_raw === watermark && seenAtWatermark.has(r.pago_id)));
    if (fresh.length === 0) return;

    const recipients = accessStore
      .listMemberships()
      .filter((m) => m.status === 'active' && accessStore.getNotificationOptions(m.telegramUserId).includePaymentAlerts);

    for (const r of fresh) {
      const alert = buildAlert(r);
      for (const m of recipients) {
        try {
          await bot.api.sendMessage(m.telegramUserId, alert.text, {
            parse_mode: 'HTML',
            reply_markup: alert.keyboard
          });
        } catch (err: any) {
          console.error(`❌ [PaymentWatcher] No se pudo avisar a ${m.telegramUserId}:`, err.message);
        }
      }

      // Avanzar la marca de agua
      if (r.fecha_raw !== watermark) {
        watermark = r.fecha_raw;
        seenAtWatermark.clear();
      }
      seenAtWatermark.add(r.pago_id);
    }

    console.log(`🔔 [PaymentWatcher] ${fresh.length} pago(s) nuevo(s) notificados a ${recipients.length} usuario(s).`);
  } catch (err: any) {
    console.error('⚠️ [PaymentWatcher] Error consultando pagos:', err.message);
  } finally {
    running = false;
  }
}

/**
 * Inicia el vigilante: revisa cada minuto si hay comprobantes nuevos.
 */
export function initPaymentWatcher(bot: Bot): void {
  void tick(bot); // fija la marca de agua inicial al arrancar
  cron.schedule('* * * * *', () => void tick(bot));
  console.log('🔔 Vigilante de pagos en tiempo real activado (cada 60 s).');
}
