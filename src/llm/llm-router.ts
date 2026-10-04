import OpenAI from 'openai';
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
      name: 'jag_overview',
      description: 'Resumen ejecutivo de la escuela deportiva: alumnos activos, nuevos del mes, ingresos confirmados, deuda pendiente y disciplina top.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            description: 'Expresión de fecha o mes si la indicó, ej: "este mes", "septiembre".'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'jag_student_counts',
      description: 'Cantidad de alumnos de la escuela: total, activos, inactivos o filtrados por una disciplina específica (fútbol, vóley, etc.).',
      parameters: {
        type: 'object',
        properties: {
          discipline: {
            type: 'string',
            description: 'Nombre de la disciplina deportiva si se especificó (ej: Fútbol, Vóley, Básquet).'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'jag_income_summary',
      description: 'Ingresos y dinero cobrado o recaudado por concepto de pagos y mensualidades en un período.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            description: 'Expresión de fecha o período, ej: "este mes", "septiembre", "hoy", "el mes pasado".'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'jag_debt_summary',
      description: 'Deudas, dinero pendiente de cobro, mensualidades sin pagar o cobranzas pendientes de la escuela.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            description: 'Expresión de fecha o mes para calcular la deuda, ej: "este mes", "septiembre".'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'jag_pending_payments',
      description: 'Listado con nombres y montos de los alumnos que deben mensualidades o tienen comprobantes pendientes de verificación.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            description: 'Mes o período para listar deudores, ej: "este mes", "septiembre".'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'jag_enrollments',
      description: 'Nuevos alumnos que ingresaron, nuevas inscripciones o matrículas en un período de tiempo.',
      parameters: {
        type: 'object',
        properties: {
          period: {
            type: 'string',
            description: 'Período temporal, ej: "este mes", "esta semana", "septiembre".'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'jag_capacity',
      description: 'Capacidad de horarios, cupos máximos, cupos ocupados y vacantes disponibles en los horarios de entrenamiento.',
      parameters: {
        type: 'object',
        properties: {
          discipline: {
            type: 'string',
            description: 'Disciplina deportiva si se especificó (ej: Fútbol, Vóley).'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'jag_recent_students',
      description: 'Consultar el alumno más reciente, quién es el más nuevo, o ver los últimos alumnos inscritos en la escuela.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Cantidad de alumnos a mostrar (por defecto 5).'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'jag_sql_query',
      description: 'Ejecuta una consulta SQL SELECT de solo lectura en la base de datos de Jaguares para responder cualquier pregunta analítica, comparativa o ad-hoc sobre alumnos, deportes, inscripciones o pagos que no cubran las herramientas fijas.',
      parameters: {
        type: 'object',
        properties: {
          sql: {
            type: 'string',
            description: 'Consulta SQL SELECT pura. Solo SELECT está permitido. Tablas: alumnos, deportes, horarios, inscripciones, pagos_mensuales.'
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
      description: 'Usar cuando la pregunta del usuario no tiene ninguna relación con la escuela deportiva ni sus métricas de negocio.',
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

  const model = currentProvider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini';

  try {
    const systemPrompt =
      'Eres el asistente virtual inteligente de la Escuela Deportiva Jaguares con acceso directo a su base de datos MySQL (solo lectura).\n' +
      'Tienes herramientas predefinidas para métricas comunes (resumen general, alumnos, ingresos, deudas, cupos, últimos inscritos).\n' +
      'Si el usuario hace una pregunta analítica, comparativa, de horarios o de alumnos específicos, USA la herramienta jag_sql_query con una consulta SELECT válida y optimizada.\n\n' +
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
      '- pagos_mensuales(pago_id, alumno_id, mes, año, monto, estado, metodo_pago, fecha_pago)\n\n' +
      'FORMATO Y ORDEN DE RESPUESTAS (Telegram Empresarial):\n' +
      '1. Si una consulta no devuelve resultados (por ejemplo si preguntan por vóley los martes y ese deporte solo se dicta lunes, miércoles y viernes), acláralo amablemente al usuario indicando los días y horarios reales en que sí se dicta.\n' +
      '2. Presentación ordenada y profesional:\n' +
      '   • Agrupa por deporte con emoji representativo y título en negrita: **⚽ Fútbol**, **🏀 Básquet**, **🏐 Vóley**, **💪 MAMAS FIT**, etc.\n' +
      '   • Dentro de cada disciplina, organiza los horarios en orden cronológico (mañana a tarde) con viñetas limpias: "- 08:30 – 09:40: Categorías 2010 y 2011".\n' +
      '   • Si listas alumnos, resalta el nombre en negrita: "- **Nombre Apellido** (Horario / Nivel)" ordenados prolijamente.\n' +
      '3. Usa **negrita** para títulos, deportes, nombres y cifras destacadas.\n' +
      '4. En jag_sql_query usa ÚNICAMENTE sentencias SELECT. Nunca modificaciones.\n' +
      '5. Nunca devuelvas código de invocación interno ni etiquetas técnicas como DSML al usuario.';

    const historyParams: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = (options.history || []).map((m) => ({
      role: m.role,
      content: m.content
    }));

    const currentMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...historyParams,
      { role: 'user', content: userText }
    ];

    const maxIterations = 4;
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
          return {
            intent: 'general.direct_response',
            confidence: 0.98,
            slots: {
              rawText: userText,
              directResponse: cleanContent
            }
          };
        }
        return null;
      }

      // Si es la primera iteración y llamó a una tool predefinida de métricas (no SQL libre)
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

        const intentMap: Record<string, JaguaresIntent> = {
          jag_overview: 'jag.overview',
          jag_student_counts: 'jag.student_counts',
          jag_income_summary: 'jag.income_summary',
          jag_debt_summary: 'jag.debt_summary',
          jag_pending_payments: 'jag.pending_payments',
          jag_enrollments: 'jag.enrollments',
          jag_recent_students: 'jag.recent_students',
          jag_capacity: 'jag.capacity'
        };

        const intent = intentMap[fnName];
        if (intent) {
          let args: any = {};
          try {
            args = JSON.parse(firstCall?.function?.arguments || '{}');
          } catch {
            args = {};
          }
          const periodStr = args.period || 'este mes';
          const resolvedPeriod = resolvePeriod(periodStr, options);
          return {
            intent,
            confidence: 0.95,
            slots: {
              period: resolvedPeriod,
              discipline: args.discipline,
              rawText: userText
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
              const rows = await executeReadOnlyQuery(callArgs.sql);
              currentMessages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(rows.slice(0, 25))
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
        return {
          intent: 'general.direct_response',
          confidence: 0.98,
          slots: {
            rawText: userText,
            directResponse: finalContent
          }
        };
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
