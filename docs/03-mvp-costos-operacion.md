# 03 — MVP, fases, costos y operación

Cubre: costos de IA, MVP, fases 2 y 3, fallback, testing, deployment,
monitoreo, escalabilidad, riesgos, errores a evitar y preguntas abiertas.

---

## 1. Estrategia de costos de IA

### 1.1 Dónde se gasta

| Etapa | ¿LLM? | Tokens aprox. |
|---|---|---|
| Reglas (70-85 % de mensajes) | No | 0 |
| Router LLM (resto) | Modelo pequeño | ~1,000-1,500 entrada (prompt + JSON Schema de las herramientas permitidas) + ~60 salida |
| Redacción de respuesta | **No** (plantillas) | 0 |
| Análisis explicativo (fase 2, opt-in) | Modelo mediano | ~2,000 entrada + 300 salida |

### 1.2 Orden de magnitud

```
costo_mensual_tenant ≈ consultas_mes × %LLM × (tok_in × precio_in + tok_out × precio_out)
ej.: 1,000 × 0.25 × (1,300 × $0.30/M + 60 × $1.20/M) ≈ $0.12 / mes
```

Con modelos de gama "mini / flash-lite / deepseek-chat" el costo del router es
**marginal** frente a la infraestructura. El riesgo real no es el precio
unitario sino el **abuso** (alguien enviando miles de mensajes) ⇒ presupuestos.

> [!NOTE]
> Los precios cambian a menudo; verificar las tarifas vigentes de cada proveedor
> al implementar. La fórmula y la medición en `llm_usage` son lo importante.

### 1.3 Comparación de proveedores para *este* caso (clasificación + slots en español)

| Proveedor | Fortalezas | Cuidado | Rol sugerido |
|---|---|---|---|
| **Gemini (Flash/Flash-Lite)** | Muy barato, rápido, buen español, tool calling sólido | Usar tier de pago (los gratuitos pueden usar datos para mejorar productos) | **Primario** |
| **OpenAI (mini/nano)** | Tool calling y *structured outputs* muy fiables | Algo más caro | **Fallback** |
| **DeepSeek** | El más barato, API compatible OpenAI | Procesamiento fuera de tu jurisdicción, disponibilidad variable; revisar si tus clientes lo aceptan | Opcional / desarrollo |
| **Claude (Haiku/Sonnet)** | Excelente seguimiento de instrucciones y análisis | Más caro para clasificación pura | Fase 2: `analysis.explain` |

Como el router solo envía **la pregunta del usuario** (sin cifras ni PII, porque
las respuestas son plantillas), la exposición de datos al proveedor es baja,
pero debe declararse en la política de privacidad.

### 1.4 Controles

- Presupuesto diario por tenant (p. ej. US$ 0.50) y global; al superarlo, solo reglas.
- Rate limit por usuario 20/min, por tenant 100/min, global configurable;
  mensajes > 500 caracteres rechazados.
- Caché de interpretación: `hash(texto_normalizado + permisos)` → resultado del
  router, 24 h (las preguntas se repiten mucho).
- Métrica "tasa de LLM": si sube, ampliar la gramática con los casos reales
  (aprendizaje a partir de `llm_usage` + intención resultante, sin texto crudo:
  guardar solo frases anonimizadas que el operador aprueba).

---

## 2. MVP (≈ 6-8 semanas de una persona)

### Alcance

| Bloque | Incluye |
|---|---|
| Plataforma | Monorepo, Bot DB, gateway Fastify + grammY en webhook, Admin API mínima (CLI), JWKS |
| Identidad | Códigos de vinculación (deep-link + manual), `/invitar`, `/miembros`, revocación, `/empresa` |
| Permisos | Catálogo, 4 roles, overrides, Policy Engine |
| Pipeline | Normalizer, RuleRouter, DateResolver, LLMRouter con 2 proveedores, contexto 15 min, plantillas |
| POS | **Sync Agent** (cursor) + **POS Hub** (ingesta + read model + 8 endpoints BI) + 8 herramientas |
| Jaguares | Middleware JWT + vistas `bi_*` + 7 endpoints + 7 herramientas |
| Seguridad | Rate limit en memoria, auditoría, redacción de logs, presupuesto LLM |
| Operación | Docker, despliegue Dokploy, health checks, Sentry, métricas básicas |

### Herramientas MVP

- **POS (8)**: `sales_summary`, `sales_by_day`, `top_products`, `product_sales`,
  `payment_methods`, `stock_alerts`, `product_stock`, `receivables`.
- **Jaguares (7)**: `overview`, `student_counts`, `enrollments`, `income_summary`,
  `payments_to_verify`, `unpaid_students` (estimación, si apruebas la regla), `capacity`.

### Orden de construcción recomendado

1. **Semana 0 (prerrequisito, en marketPOS)**: retirar `CLOUD_DATABASE_URL` de la
   distribución y rotar credenciales.
2. Paquetes base: `contracts`, `date-resolver` (con tests), `query-core`.
3. Gateway: identidad, vinculación, permisos, auditoría — con un conector *fake*.
4. **Jaguares primero**: ya está en la nube y no requiere sync ⇒ valor rápido y
   valida todo el pipeline de punta a punta.
5. POS Hub + Sync Agent (lo más largo).
6. Herramientas POS, reconciliación contra reportes del POS.
7. LLM Router y golden set; piloto con 1-2 clientes reales.

### Criterio de salida del MVP

- 0 fugas entre tenants en la suite de aislamiento.
- Cifras idénticas a los reportes de cada sistema en el set de reconciliación.
- ≥ 90 % de acierto de intención en el golden set (300 frases).
- p95 < 3 s; disponibilidad del gateway ≥ 99.5 % durante el piloto.

---

## 3. Fase 2 (2-3 meses después)

- Botón "Conectar Telegram" en paneles de Monterrial y Jaguares.
- Herramientas: turnos/caja, anulaciones, ventas por hora, utilidad con cobertura
  de costos, lotes por vencer, retiros (con `fecha_cancelacion`), asistencias.
- **Gráficos**: PNG generado en servidor (Chart.js + `@napi-rs/canvas` o
  Vega-Lite) enviado con `sendPhoto`; empezar con "ventas últimos 7/30 días".
- **Reportes** PDF/Excel/CSV con `sendDocument` (cola BullMQ ⇒ entra Redis),
  permiso `reports.export`, enlaces nunca públicos.
- **Resumen diario programado** (opt-in): "Cierre de hoy: S/ 2,140 · 61 ventas".
  Es probablemente la función más valorada por dueños.
- **Alertas** opt-in: stock agotado de productos top, sync caída > 2 h.
- PIN para herramientas sensibles, outbox transaccional en el POS si hace falta.
- `analysis.explain` con validación de cifras.
- Redis + 2 réplicas del gateway.

## 4. Fase 3 (producto)

- Canal WhatsApp (Cloud API) reutilizando `query-core`.
- Conectores nuevos (restaurante, gimnasio, farmacia) con SDK de conector y
  *contract tests* publicables.
- Bots white-label por cliente (`bot_instances` con token propio).
- Portal de autoservicio: usuarios, permisos, auditoría, consumo.
- Herramientas de escritura con confirmación explícita, idempotencia y doble
  autorización.
- Extraer `query-core` como servicio si aparecen consumidores externos (API pública
  para partners con OAuth2 client credentials).
- Particionado de auditoría, réplicas de lectura para el Hub.

---

## 5. Fallback y resiliencia

| Falla | Comportamiento |
|---|---|
| Proveedor LLM caído / timeout 4 s | Circuit breaker → proveedor secundario → solo reglas + "No entendí del todo. Prueba: *ventas hoy*, *stock bajo*" + menú |
| API BI caída | Timeout 5 s, 1 reintento con *jitter* para GET; "No pude conectar con Tienda Centro ahora. Intenta en unos minutos." Circuit breaker por conexión |
| POS sin sincronizar | Responder con datos disponibles + aviso de frescura |
| Bot DB caída | `/readyz` falla; el gateway responde 200 a Telegram (para que no reintente en bucle) y envía mensaje genérico si puede |
| Telegram caído | Telegram reintenta los webhooks; dedupe por `update_id` evita duplicados |
| Resultado demasiado grande | Truncar a N filas con "y 34 más" |

---

## 6. Testing

| Nivel | Qué | Herramienta |
|---|---|---|
| Unitario | DateResolver (tabla de ~150 casos, reloj y zona fijos, cambios de año, trimestres), normalizer, renderer (formato es-PE, escape HTML), cálculo de permisos | Vitest |
| Router | **Golden set** de 300+ frases reales en español peruano → `{intent, slots}` esperado. Reglas en cada CI; LLM nightly por proveedor con reporte de acierto y costo | Vitest + script |
| Seguridad | Matriz rol × herramienta; **aislamiento**: tokens con `ext` ajeno, tokens expirados, `aud` incorrecto, RLS sin `app.store_refs`; suite de prompt injection (50+ ataques) verificando que nunca se ejecute una herramienta no permitida | Vitest + Testcontainers |
| Contrato | Zod compartido entre conectores y APIs BI; *consumer-driven contract tests* | Vitest |
| Reconciliación | Mismos periodos en reporte del POS / panel de Jaguares vs bot, sobre una copia anonimizada (nunca BD real) | Script |
| Ingesta | Idempotencia, reordenamiento, lotes duplicados, anulaciones posteriores, relojes desfasados | Vitest |
| E2E | Bot de staging con cuenta de prueba (Telegram test environment) | Manual + script |
| Carga | 50 msgs/s sostenidos al gateway; consultas de 1 año en Hub | k6 |

---

## 7. Deployment

- **Contenedores**: `bot-gateway` y `pos-hub` (Node 22 alpine, usuario no root,
  `npm ci --omit=dev`, imágenes multi-stage).
- **Infra MVP**: tu VPS con Dokploy (ya lo usas para Jaguares) + Postgres
  gestionado (Supabase/Neon/RDS) o Postgres en el VPS con backups cifrados
  diarios y prueba de restauración mensual. Bot DB y Hub DB como **bases o
  esquemas separados con roles distintos**.
- **Entornos**: `staging` (bot de pruebas propio) y `prod` (bot oficial). Nunca
  compartir token de bot entre entornos.
- **Webhook**: `setWebhook` con `secret_token`, `allowed_updates: ["message",
  "callback_query"]`, `drop_pending_updates` solo en despliegues controlados.
- **Migraciones**: `prisma migrate deploy` en un job previo; nunca `db push` en prod.
- **Secretos**: token del bot, claves ES256, credenciales LLM y BD en el gestor de
  secretos del orquestador; rotación documentada.
- CI: lint + typecheck + tests + build de imágenes; despliegue manual aprobado a prod.

## 8. Monitoreo

| Señal | Alerta |
|---|---|
| Latencia p95 por herramienta y por router | > 3 s durante 10 min |
| Errores por conexión (circuit breaker abierto) | inmediato |
| **Lag de sincronización por tienda** | > 2 h en horario comercial |
| Tasa de "no entendí" / `out_of_scope` | tendencia semanal (producto) |
| % de mensajes que van al LLM y costo por tenant | presupuesto 80 % |
| `query.denied` anómalos / canjes fallidos de códigos | picos (posible ataque) |
| Rate limit disparado | por tenant |
| Salud de webhook (`getWebhookInfo.pending_update_count`) | > 100 |

Stack: pino → stdout → (Loki/Grafana o Better Stack), Sentry para errores,
métricas Prometheus en `/metrics` interno, uptime externo sobre `/healthz`.

---

## 9. Escalabilidad

| Componente | 10-50 clientes | 100-500 | 1000 | Mitigación |
|---|---|---|---|---|
| Telegram API | Sin problema | Sin problema | Límite ~30 msg/s globales por bot: afecta **difusiones** (resúmenes diarios) | Cola con *throttling* para envíos programados; escalonar horarios |
| Gateway | 1 réplica | 2 réplicas + Redis | Horizontal | Stateless salvo sesión (Postgres/Redis) |
| Bot DB | Trivial | Auditoría crece | Particionar `audit_logs` por mes | Índices por `tenant_id, at`, retención |
| POS Hub ingesta | Trivial | Picos al reconectar PCs offline | Cola de ingesta | Lotes acotados, backpressure (429 + `Retry-After`) |
| POS Hub consultas | Trivial | Rollups diarios necesarios | Réplica de lectura | Rollups por día/producto, índices `(store_ref, local_date)` |
| LLM | Marginal | Marginal | Rate limits del proveedor | Multi-proveedor, caché de interpretación |
| Jaguares MySQL | Una escuela | — | — | Vistas indexadas, caché 60 s |
| Supabase | Plan base | Revisar conexiones | Pooler (PgBouncer) | Prisma con `connection_limit` |

El primer cuello de botella real será la **ingesta y las consultas del Hub**
cuando haya cientos de tiendas con años de historial, no Telegram ni el LLM.

---

## 10. Riesgos técnicos

| Riesgo | Prob. | Impacto | Mitigación |
|---|---|---|---|
| Credenciales cloud del POS ya distribuidas | Alta (confirmado) | Crítico | Rotación inmediata + login cloud vía API |
| Cifras del bot distintas a las del POS | Alta | Alto (confianza) | Reglas de negocio únicas (doc 02 §3), reconciliación automatizada |
| Huecos de sincronización (cursor) | Media | Alto | Solape + reconciliación diaria de conteos por día (`/ingest/v1/checksums`) |
| Definición ambigua de deuda/retiros en Jaguares | Alta | Medio | Etiquetar estimaciones, agregar columnas faltantes |
| Robo de cuenta de Telegram | Baja | Alto | 2FA recomendado, revocación, PIN fase 2, `dormant` |
| Errores del LLM en slots | Media | Medio | Validación zod, confirmación cuando el periodo es inusual, reglas primero |
| Cambios de esquema en POS/Jaguares rompen el BI | Media | Medio | Contratos versionados (`/bi/v1`), tests de contrato en ambos repos |
| Dependencia de un proveedor LLM | Baja | Bajo | `LLMProvider` + fallback + modo solo reglas |
| Expectativa de "IA que sabe todo" | Alta | Medio | Onboarding con ejemplos, `/ayuda` contextual, respuestas honestas |

## 11. Errores que debes evitar

1. Dejar que el LLM genere SQL o que vea IDs/tenants.
2. Construir la analítica sobre la BD cloud actual del POS antes de cerrar la fuga de credenciales.
3. Usar `service_role` de Supabase en rutas de consulta (ignora RLS).
4. Sumar `paymentMethod = 'YAPE'` ignorando `MIXED`, o contar `FIADO` como dinero cobrado.
5. Olvidar excluir anulaciones (`total <= 0`) y `isDemo`.
6. Comparar un mes parcial contra un mes completo sin decirlo.
7. Calcular fechas con la zona horaria del servidor (`new Date()` + `getDate()`).
8. Usar `number` para dinero.
9. Guardar mensajes completos "por si acaso" (riesgo legal y de fuga).
10. Hacer que el LLM redacte las cifras finales.
11. Un solo API key global entre sistemas en lugar de tokens cortos con audiencia.
12. Exponer nombres de alumnos menores o deudores sin permiso específico.
13. Funcionar en grupos de Telegram (cualquier miembro vería los datos).
14. Construir 40 herramientas antes de validar 10 con clientes reales.
15. Prometer "tiempo real" para el POS: es "al último sincronizado", y se muestra.

---

## 12. Preguntas abiertas (necesito tus respuestas para cerrar el diseño)

1. **POS en la nube**: ¿algún cliente usa Monterrial directamente contra la BD cloud
   (modo web), o todos son instalaciones de escritorio? ¿La BD cloud tiene ventas
   reales hoy?
2. **Jaguares**: ¿se venderá a otras escuelas (multi-tenant real) o es una sola?
3. **Deuda en Jaguares**: ¿cuándo vence la mensualidad, cómo se tratan alumnos con
   varias disciplinas, descuentos y becas? ¿Apruebas la regla "estimada" de doc 02 §3.2
   o prefieres crear un modelo de cargos mensuales?
4. **Ingresos en Jaguares**: ¿`alumnos.monto_pago` y `pagos` duplican la misma
   matrícula? ¿Qué fecha cuenta: pago o verificación?
5. **Hosting**: ¿VPS con Dokploy + Postgres gestionado (Supabase) te parece bien?
6. **Proveedor LLM**: ¿alguna restricción de residencia de datos para tus clientes
   (excluir DeepSeek)?
7. **Bot único** (`@MonterrialBot` para todos) en el MVP y white-label después — ¿de acuerdo?
8. ¿Prefieres que el MVP arranque con **Jaguares** (más rápido, sin sync) como propongo?
