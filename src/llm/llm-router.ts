import OpenAI from 'openai';
import { DateTime } from 'luxon';
import { resolvePeriod } from '../date-resolver/date-resolver.js';
import { JaguaresIntent, RouteMatch } from '../pipeline/rule-router.js';
import { executeReadOnlyQuery } from '../connectors/jaguares/jaguares-db.js';

let openaiClient: OpenAI | null = null;
let currentProvider: 'deepseek' | 'openai' | 'none' = 'none';

export function initLLMClient(): void {
  const deepseekKey = process.env.DEEPSEEK_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (deepseekKey && deepseekKey.trim() !== '') {
    openaiClient = new OpenAI({
      apiKey: deepseekKey,
      baseURL: 'https://api.deepseek.com'
    });
    currentProvider = 'deepseek';
    console.log('🧠 LLM activado: DeepSeek (https://api.deepseek.com)');
  } else if (openaiKey && openaiKey.trim() !== '') {
    openaiClient = new OpenAI({
      apiKey: openaiKey
    });
    currentProvider = 'openai';
    console.log('🧠 LLM activado: OpenAI');
  } else {
    currentProvider = 'none';
  }
}

export function isLLMEnabled(): boolean {
  if (!openaiClient) {
    initLLMClient();
  }
  return currentProvider !== 'none' && openaiClient !== null;
}

const TOOLS_DEFINITIONS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'jag_sql_query',
      description:
        'Ejecuta una consulta SQL SELECT de solo lectura en MySQL para responder preguntas sobre alumnos, deportes, horarios, inscripciones, asistencias, control de docentes o pagos.',
      parameters: {
        type: 'object',
        properties: {
          sql: {
            type: 'string',
            description:
              'Consulta SQL SELECT de solo lectura. Tablas disponibles: alumnos, deportes, horarios, inscripciones, inscripcion_horarios, asistencias, administradores, profesor_deportes, pagos_mensuales.'
          }
        },
        required: ['sql']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'out_of_scope',
      description: 'Usar cuando la pregunta del usuario no tiene relación con la Escuela Deportiva Jaguares ni sus datos o métricas.',
      parameters: {
        type: 'object',
        properties: {
          motivo: { type: 'string' }
        }
      }
    }
  }
];

function cleanLLMText(text: string): string {
  if (!text) return '';
  return text
    .replace(/<\s*\|\s*\|\s*DSML[\s\S]*$/gi, '')
    .replace(/<[\s|]*DSML[\s\S]*?(\/?>|<\/.*?DSML.*?>)/gi, '')
    .replace(/<\|.*?\|>/g, '')
    .trim();
}

interface CacheEntry {
  match: RouteMatch;
  expiresAt: number;
}
const llmResponseCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos (ahorro de tokens en preguntas repetidas)

/**
 * Enruta un mensaje usando LLM (DeepSeek / OpenAI) con soporte para llamadas a funciones
 * y consultas analíticas a MySQL (solo lectura) en múltiples rondas de interacción.
 */
export async function routeMessageWithLLM(
  userText: string,
  options: {
    now?: Date;
    timezone?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  } = {}
): Promise<RouteMatch | null> {
  if (!isLLMEnabled() || !openaiClient) {
    return null;
  }

  // Ahorro de tokens: Cache en memoria para preguntas idénticas sin historial previo
  const cacheKey = userText.trim().toLowerCase();
  const hasHistory = Boolean(options.history && options.history.length > 0);
  if (!hasHistory && llmResponseCache.has(cacheKey)) {
    const entry = llmResponseCache.get(cacheKey)!;
    if (Date.now() < entry.expiresAt) {
      console.log(`⚡ [LLM Cache Hit]: Respondiendo "${userText}" desde caché (0 tokens gastados)`);
      return entry.match;
    } else {
      llmResponseCache.delete(cacheKey);
    }
  }

  const model = currentProvider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini';

  try {
    const tz = options.timezone || 'America/Lima';
    const nowDateTime = options.now
      ? DateTime.fromJSDate(options.now).setZone(tz)
      : DateTime.now().setZone(tz);
    const todayStr = nowDateTime.toFormat('yyyy-MM-dd');
    const yesterdayStr = nowDateTime.minus({ days: 1 }).toFormat('yyyy-MM-dd');
    const dayOfWeekEs = [
      'LUNES',
      'MARTES',
      'MIÉRCOLES',
      'JUEVES',
      'VIERNES',
      'SÁBADO',
      'DOMINGO'
    ][nowDateTime.weekday - 1];

    // OJO: No incluir segundos en el system prompt para permitir DeepSeek Context Caching (ahorro del 90%)
    const systemPrompt =
      'Eres el asistente virtual inteligente de la Escuela Deportiva Jaguares con acceso directo a su base de datos MySQL (solo lectura).\n' +
      'Tienes herramientas predefinidas para métricas comunes (resumen general, alumnos, ingresos, deudas, cupos, últimos inscritos).\n' +
      'Si el usuario hace una pregunta analítica, comparativa, de horarios, de asistencias o de alumnos específicos, USA la herramienta jag_sql_query con una consulta SELECT válida y optimizada.\n\n' +
      'FECHA DE REFERENCIA (Zona Horaria America/Lima):\n' +
      `- Fecha de hoy: ${todayStr} (Día: ${dayOfWeekEs})\n` +
      `- Fecha de ayer: ${yesterdayStr}\n` +
      `Si preguntan por "hoy", consulta con fecha = '${todayStr}'.\n` +
      `Si preguntan por "ayer", consulta con fecha = '${yesterdayStr}'.\n\n` +
      'CONSERVACIÓN DE CONTEXTO Y CONVERSACIÓN:\n' +
      '- Tienes acceso al historial reciente de mensajes de la conversación.\n' +
      '- Si el usuario responde brevemente ("Sí", "Claro", "Por favor", "Detállalo", "Y el jueves?", "¿Cuáles son?"), interpreta su respuesta en el contexto de tu último mensaje y procede con la información o detalle que se le ofreció.\n\n' +
      'ESTRUCTURA DE TABLAS EN MYSQL (jaguares_db):\n' +
      '- alumnos(alumno_id, dni, nombres, apellido_paterno, apellido_materno, fecha_nacimiento, sexo, telefono, apoderado, estado, estado_pago)\n' +
      '  Valores de sexo: \'Femenino\', \'Masculino\'.\n' +
      '  Valores de estado: \'activo\'.\n' +
      '  Para fechas de nacimiento válidas usa siempre: fecha_nacimiento IS NOT NULL AND fecha_nacimiento > \'1950-01-01\' (NUNCA \'0000-00-00\').\n' +
      '- deportes(deporte_id, nombre, matricula, estado)\n' +
      '  Deportes registrados: Fútbol, Fútbol Femenino, Vóley, Básquet, MAMAS FIT, Baby Futbol, Entrenamiento Funcional Mixto, GYM JUVENIL.\n' +
      '  Busca deportes con tolerancia a tildes: (d.nombre LIKE \'%v%ley%\' OR d.nombre LIKE \'%f%tbol%\' OR d.nombre LIKE \'%futbol%\' OR d.nombre LIKE \'%basquet%\' OR d.nombre LIKE \'%básquet%\').\n' +
      '- horarios(horario_id, deporte_id, dia, hora_inicio, hora_fin, cupo_maximo, cupos_ocupados, categoria, nivel, precio, estado)\n' +
      '  ¡IMPORTANTE!: La columna dia está en MAYÚSCULAS en la base de datos: \'LUNES\', \'MARTES\', \'MIERCOLES\', \'JUEVES\', \'VIERNES\', \'SABADO\'.\n' +
      '- inscripciones(inscripcion_id, alumno_id, deporte_id, fecha_inscripcion, estado, plan, precio_mensual)\n' +
      '  ¡OJO AL ESTADO!: Los valores son: \'activa\', \'pendiente\', \'cancelada\' (termina en "a": \'activa\').\n' +
      '- inscripcion_horarios(id, inscripcion_id, horario_id, estado)\n' +
      '  ¡TABLA CLAVE PARA HORARIOS DE ALUMNOS!:\n' +
      '  La relación entre alumnos y sus horarios de clase asignados se realiza a través de inscripcion_horarios.\n' +
      '  Para saber qué alumnos asisten o están inscritos en un día o horario específico, DEBES unir así:\n' +
      '  SELECT a.nombres, a.apellido_paterno, a.apellido_materno, d.nombre AS deporte, h.dia, h.hora_inicio, h.hora_fin\n' +
      '  FROM alumnos a\n' +
      '  JOIN inscripciones i ON a.alumno_id = i.alumno_id\n' +
      '  JOIN inscripcion_horarios ih ON i.inscripcion_id = ih.inscripcion_id\n' +
      '  JOIN horarios h ON ih.horario_id = h.horario_id\n' +
      '  JOIN deportes d ON h.deporte_id = d.deporte_id\n' +
      '  WHERE UPPER(h.dia) = \'MARTES\' AND (i.estado = \'activa\' OR i.estado = \'activo\')\n' +
      '- asistencias(asistencia_id, alumno_id, horario_id, fecha, presente, asistencia_puerta, hora_puerta, observaciones, registrado_por, created_at)\n' +
      '  ¡TABLA OFICIAL DE ASISTENCIAS DE ALUMNOS (Doble registro: Docente + Puerta)!:\n' +
      '  - fecha: fecha de la clase (tipo DATE: \'YYYY-MM-DD\').\n' +
      '  - presente: tinyint (1 = El docente/profesor marcó PRESENTE en lista, 0 = ausente/falta).\n' +
      '  - asistencia_puerta: tinyint (1 = El alumno registró ingreso en la PUERTA con carnet/código QR, 0 = no registró puerta).\n' +
      '  - hora_puerta: time (Hora exacta registrada en puerta al escanear carnet, ej: \'07:58:00\').\n' +
      '  - observaciones: notas del docente.\n' +
      '  ¡CONSULTAS CLAVE DE ASISTENCIAS!:\n' +
      '  • Asistencias de un día (ej. ayer o una fecha específica):\n' +
      '    SELECT a.nombres, a.apellido_paterno, d.nombre AS deporte, h.dia, ' +
      'TIME_FORMAT(h.hora_inicio, \'%H:%i\') AS hora_inicio, TIME_FORMAT(h.hora_fin, \'%H:%i\') AS hora_fin, ' +
      'ast.presente, ast.asistencia_puerta, TIME_FORMAT(ast.hora_puerta, \'%H:%i\') AS hora_puerta, ast.observaciones\n' +
      '    FROM asistencias ast\n' +
      '    JOIN alumnos a ON ast.alumno_id = a.alumno_id\n' +
      '    JOIN horarios h ON ast.horario_id = h.horario_id\n' +
      '    JOIN deportes d ON h.deporte_id = d.deporte_id\n' +
      '    WHERE ast.fecha = \'YYYY-MM-DD\'\n' +
      '    ORDER BY d.nombre, h.hora_inicio, a.apellido_paterno;\n' +
      '  • Resumen o estadísticas de asistencias de una fecha:\n' +
      '    SELECT COUNT(*) AS total_registros, ' +
      'SUM(CASE WHEN ast.presente = 1 THEN 1 ELSE 0 END) AS presentes_docente, ' +
      'SUM(CASE WHEN ast.asistencia_puerta = 1 THEN 1 ELSE 0 END) AS asistencias_puerta, ' +
      'SUM(CASE WHEN ast.presente = 0 THEN 1 ELSE 0 END) AS ausentes\n' +
      '    FROM asistencias ast WHERE ast.fecha = \'YYYY-MM-DD\';\n' +
      '  • Historial de asistencias de un alumno por DNI o apellido:\n' +
      '    SELECT DATE_FORMAT(ast.fecha, \'%Y-%m-%d\') AS fecha, d.nombre AS deporte, ' +
      'ast.presente, ast.asistencia_puerta, TIME_FORMAT(ast.hora_puerta, \'%H:%i\') AS hora_puerta\n' +
      '    FROM asistencias ast\n' +
      '    JOIN alumnos a ON ast.alumno_id = a.alumno_id\n' +
      '    JOIN horarios h ON ast.horario_id = h.horario_id\n' +
      '    JOIN deportes d ON h.deporte_id = d.deporte_id\n' +
      '    WHERE a.dni = \'...\' OR a.apellido_paterno LIKE \'%...%\'\n' +
      '    ORDER BY ast.fecha DESC LIMIT 20;\n' +
      '- administradores(admin_id, nombre_completo, usuario, email, rol, estado, ultimo_acceso)\n' +
      '  ¡TABLA DE PROFESORES Y DOCENTES!:\n' +
      '  Los docentes y profesores de la escuela tienen rol = \'profesor\' y estado = \'activo\'.\n' +
      '- profesor_deportes(id, admin_id, deporte_id, categoria, dia, horario_id)\n' +
      '  Asignación de profesores a sus deportes y horarios de clase.\n' +
      '  ¡CONTROL DE DOCENTES Y ASISTENCIAS!:\n' +
      '  • ¿Qué docentes ya pasaron lista hoy / en una fecha?:\n' +
      '    SELECT adm.nombre_completo AS profesor, d.nombre AS deporte, h.hora_inicio, h.hora_fin, ' +
      'COUNT(ast.asistencia_id) AS total_alumnos, ' +
      'SUM(CASE WHEN ast.presente = 1 THEN 1 ELSE 0 END) AS presentes, ' +
      'SUM(CASE WHEN ast.asistencia_puerta = 1 THEN 1 ELSE 0 END) AS puerta_ok\n' +
      '    FROM asistencias ast\n' +
      '    JOIN administradores adm ON ast.registrado_por = adm.admin_id\n' +
      '    JOIN horarios h ON ast.horario_id = h.horario_id\n' +
      '    JOIN deportes d ON h.deporte_id = d.deporte_id\n' +
      '    WHERE ast.fecha = \'YYYY-MM-DD\'\n' +
      '    GROUP BY adm.admin_id, adm.nombre_completo, d.nombre, h.hora_inicio, h.hora_fin;\n' +
      '  • ¿Qué docentes faltan pasar lista hoy?:\n' +
      '    SELECT adm.nombre_completo AS profesor, d.nombre AS deporte, h.hora_inicio, h.hora_fin\n' +
      '    FROM profesor_deportes pd\n' +
      '    JOIN administradores adm ON pd.admin_id = adm.admin_id\n' +
      '    JOIN horarios h ON pd.horario_id = h.horario_id\n' +
      '    JOIN deportes d ON pd.deporte_id = d.deporte_id\n' +
      '    WHERE UPPER(h.dia) = \'DIA_SEMANA\' AND adm.estado = \'activo\'\n' +
      '      AND h.horario_id NOT IN (\n' +
      '        SELECT DISTINCT horario_id FROM asistencias WHERE fecha = \'YYYY-MM-DD\'\n' +
      '      );\n' +
      '  • Ver la lista de alumnos y asistencias evaluadas por un docente:\n' +
      '    SELECT a.nombres, a.apellido_paterno, a.dni, ast.presente, ast.asistencia_puerta, TIME_FORMAT(ast.hora_puerta, \'%H:%i\') AS hora_puerta, ast.observaciones\n' +
      '    FROM asistencias ast\n' +
      '    JOIN alumnos a ON ast.alumno_id = a.alumno_id\n' +
      '    JOIN administradores adm ON ast.registrado_por = adm.admin_id\n' +
      '    WHERE ast.fecha = \'YYYY-MM-DD\' AND adm.nombre_completo LIKE \'%...%\'\n' +
      '    ORDER BY a.apellido_paterno;\n' +
      '  ¡CUMPLEAÑOS DE ALUMNOS!:\n' +
      '  • ¿Quién cumple años hoy/esta semana/este mes?:\n' +
      '    SELECT nombres, apellido_paterno, DATE_FORMAT(fecha_nacimiento, \'%d/%m\') AS cumple, ' +
      'YEAR(CURDATE()) - YEAR(fecha_nacimiento) AS edad_cumplir, telefono\n' +
      '    FROM alumnos WHERE estado = \'activo\' AND fecha_nacimiento > \'1950-01-01\' ' +
      'AND MONTH(fecha_nacimiento) = MONTH(CURDATE()) AND DAY(fecha_nacimiento) = DAY(CURDATE());\n' +
      '  ¡BÚSQUEDA DE NÚMERO DE OPERACIÓN (ANTI-FRAUDE)!:\n' +
      '  • Buscar operación bancaria en inscripciones y mensualidades:\n' +
      '    SELECT a.dni, a.nombres, a.apellido_paterno, a.numero_operacion, a.monto_pago, a.estado_pago, \'inscripcion\' AS origen\n' +
      '    FROM alumnos a WHERE a.numero_operacion LIKE \'%NUM%\'\n' +
      '    UNION\n' +
      '    SELECT a.dni, a.nombres, a.apellido_paterno, pm.numero_operacion, pm.monto, pm.estado, \'mensualidad\' AS origen\n' +
      '    FROM pagos_mensuales pm JOIN alumnos a ON pm.alumno_id = a.alumno_id WHERE pm.numero_operacion LIKE \'%NUM%\';\n' +
      '  ¡ALERTA DE DESERCIÓN (FALTAS CRÍTICAS)!:\n' +
      '  • Alumnos con 3 o más faltas o baja asistencia:\n' +
      '    SELECT a.nombres, a.apellido_paterno, d.nombre AS deporte, ' +
      'COUNT(ast.asistencia_id) AS total_clases, SUM(CASE WHEN ast.presente = 0 THEN 1 ELSE 0 END) AS ausentes\n' +
      '    FROM alumnos a JOIN asistencias ast ON a.alumno_id = ast.alumno_id ' +
      'JOIN horarios h ON ast.horario_id = h.horario_id JOIN deportes d ON h.deporte_id = d.deporte_id\n' +
      '    WHERE a.estado = \'activo\' AND ast.fecha >= DATE_SUB(CURDATE(), INTERVAL 45 DAY)\n' +
      '    GROUP BY a.alumno_id, a.nombres, a.apellido_paterno, d.nombre\n' +
      '    HAVING ausentes >= 3 ORDER BY ausentes DESC LIMIT 15;\n' +
      '  ¡RANKING Y ALUMNOS DESTACADOS!:\n' +
      '  • Top alumnos con más asistencias del mes o 100% asistencia:\n' +
      '    SELECT a.nombres, a.apellido_paterno, d.nombre AS deporte, ' +
      'COUNT(ast.asistencia_id) AS total_clases, SUM(CASE WHEN ast.presente = 1 THEN 1 ELSE 0 END) AS presentes\n' +
      '    FROM asistencias ast JOIN alumnos a ON ast.alumno_id = a.alumno_id ' +
      'JOIN horarios h ON ast.horario_id = h.horario_id JOIN deportes d ON h.deporte_id = d.deporte_id\n' +
      '    WHERE MONTH(ast.fecha) = MONTH(CURDATE()) AND YEAR(ast.fecha) = YEAR(CURDATE())\n' +
      '    GROUP BY a.alumno_id, a.nombres, a.apellido_paterno, d.nombre\n' +
      '    ORDER BY presentes DESC LIMIT 15;\n' +
      '- pagos_mensuales(pago_id, alumno_id, mes, año, monto, estado, metodo_pago, fecha_pago)\n\n' +
      'FORMATO Y ORDEN DE RESPUESTAS (Telegram Empresarial):\n' +
      '1. Si una consulta no devuelve resultados (por ejemplo si preguntan por un día en que no hubo clases o no hay registros cargados), indícalo amablemente explicando la fecha consultada y sugiriendo verificar otra fecha o usar /asistencias <DNI>.\n' +
      '2. Al responder sobre asistencias, MUESTRA SIEMPRE AMBAS FUENTES DE REGISTRO:\n' +
      '   • Docente: 👨‍🏫 Presente o ❌ Ausente\n' +
      '   • Puerta: 🚪 Puerta (HH:mm) o ⛔ Sin puerta\n' +
      '3. Para control de docentes ("¿quién pasó lista?", "¿quién falta pasar asistencia?"), agrupa claramente en: ✅ Ya pasaron lista y ⏳ Pendientes de pasar lista.\n' +
      '4. Presentación ordenada y profesional:\n' +
      '   • Agrupa por deporte con emoji representativo y título en negrita: **⚽ Fútbol**, **🏀 Básquet**, **🏐 Vóley**, **💪 MAMAS FIT**, etc.\n' +
      '   • Organiza los horarios en orden cronológico con viñetas limpias.\n' +
      '   • Resalta el nombre de cada alumno en negrita: "- **Nombre Apellido** — 👨‍🏫 Presente | 🚪 Puerta (08:05)".\n' +
      '5. Usa **negrita** para títulos, deportes, nombres y cifras destacadas.\n' +
      '6. En jag_sql_query usa ÚNICAMENTE sentencias SELECT. Nunca modificaciones.\n' +
      '7. Nunca devuelvas código de invocación interno ni etiquetas técnicas como DSML al usuario.';

    const historyParams: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = (options.history || []).map((m) => ({
      role: m.role,
      content: m.content
    }));

    const currentMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...historyParams,
      { role: 'user', content: userText }
    ];

    const maxIterations = 2;
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;

      const response = await openaiClient.chat.completions.create({
        model,
        messages: currentMessages,
        tools: TOOLS_DEFINITIONS,
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 450
      });

      const choice = response.choices[0];
      const toolCalls = choice?.message?.tool_calls || [];

      // Si no hay tool calls, devolver la respuesta de texto directo
      if (toolCalls.length === 0) {
        const rawContent = choice?.message?.content || '';
        const cleanContent = cleanLLMText(rawContent);
        if (cleanContent) {
          const matchResult: RouteMatch = {
            intent: 'general.direct_response',
            confidence: 0.98,
            slots: {
              rawText: userText,
              directResponse: cleanContent
            }
          };
          if (!hasHistory) {
            llmResponseCache.set(cacheKey, { match: matchResult, expiresAt: Date.now() + CACHE_TTL_MS });
          }
          return matchResult;
        }
        return null;
      }

      // Si es la primera iteración y llamó a out_of_scope
      if (iteration === 1 && !toolCalls.some((c: any) => c.function?.name === 'jag_sql_query')) {
        const firstCall = toolCalls[0] as any;
        const fnName = firstCall?.function?.name;
        if (fnName === 'out_of_scope') {
          return {
            intent: 'general.direct_response',
            confidence: 0.95,
            slots: {
              rawText: userText,
              directResponse:
                'Esa pregunta está fuera del alcance de mi función. Soy el asistente virtual de la <b>Escuela Deportiva Jaguares</b> y estoy especializado en responderte sobre los alumnos, horarios, cobranzas, deudas y métricas de la escuela.\n\nSi necesitas consultar cualquier dato de Jaguares, ¡con gusto te ayudo! 🐆'
            }
          };
        }
      }

      // Registrar el mensaje del asistente con sus tool_calls
      const assistantMsg: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: choice.message.content || null,
        tool_calls: choice.message.tool_calls
      };
      currentMessages.push(assistantMsg);

      // Ejecutar cada tool call y registrar su respuesta para la siguiente ronda
      for (const rawCall of toolCalls) {
        const call = rawCall as any;
        if (call.function?.name === 'jag_sql_query') {
          let callArgs: any = {};
          try {
            callArgs = JSON.parse(call.function?.arguments || '{}');
          } catch {}

          if (callArgs.sql) {
            try {
              console.log(`🔍 [LLM Query SQL (ronda ${iteration})]:`, callArgs.sql);
              const rows: any[] = (await executeReadOnlyQuery(callArgs.sql)) as any[];
              const total = rows.length;

              // OPTIMIZACIÓN TOKENS: Limitar a 12 filas máximo y descartar campos nulos/vacíos
              const compactRows = rows.slice(0, 12).map((r) => {
                const clean: Record<string, any> = {};
                for (const [k, v] of Object.entries(r)) {
                  if (v !== null && v !== undefined && v !== '') {
                    clean[k] = v;
                  }
                }
                return clean;
              });

              const toolPayload = total > 12
                ? { total_encontrados: total, primeros_12: compactRows }
                : compactRows;

              currentMessages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(toolPayload)
              });
            } catch (sqlErr: any) {
              console.warn('⚠️ Error ejecutando query SQL del LLM:', sqlErr.message);
              currentMessages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify({ error: sqlErr.message })
              });
            }
          } else {
            currentMessages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify({ error: 'No SQL provided' })
            });
          }
        } else {
          currentMessages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ status: 'ok' })
          });
        }
      }
    }

    // Si agotó las rondas de herramientas pero tenemos datos en currentMessages, forzar redacción final:
    try {
      const finalFollowUp = await openaiClient.chat.completions.create({
        model,
        messages: currentMessages,
        temperature: 0.3,
        max_tokens: 500
      });
      const finalContent = cleanLLMText(finalFollowUp.choices[0]?.message?.content || '');
      if (finalContent) {
        const matchResult: RouteMatch = {
          intent: 'general.direct_response',
          confidence: 0.98,
          slots: {
            rawText: userText,
            directResponse: finalContent
          }
        };
        if (!hasHistory) {
          llmResponseCache.set(cacheKey, { match: matchResult, expiresAt: Date.now() + CACHE_TTL_MS });
        }
        return matchResult;
      }
    } catch (err: any) {
      console.warn('⚠️ Error en llamada forzada final del LLM:', err.message);
    }

    return null;
  } catch (error: any) {
    console.warn('⚠️ Error al llamar al LLM:', error.message);
    return null;
  }
}
