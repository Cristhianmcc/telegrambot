# 01 — Arquitectura

Cubre: arquitectura general, componentes, flujos de autenticación y consulta,
multi-tenant, permisos, seguridad, sincronización offline, integración Jaguares,
API unificada, stack y estructura de carpetas.

---

## 1. Principios no negociables

1. **El tenant sale de la identidad, nunca del mensaje.** `telegram_user_id →
   membresía activa → tenant`. Ningún parámetro de herramienta acepta `tenant_id`.
2. **Doble enforcement.** El bot verifica permisos antes de llamar; la API del
   sistema vuelve a verificar el token firmado (tenant + scopes). Si el bot falla,
   la API bloquea.
3. **Solo lectura por construcción.** El registro de herramientas rechaza
   herramientas `kind: 'write'` en fase 1; los tokens emitidos solo llevan scopes
   `*.read`; los usuarios de BD de las APIs BI solo tienen `SELECT`.
4. **El LLM es un traductor, no un oráculo.** Convierte texto → `{intent, slots}`.
   No ve IDs, no ve tenants, no ejecuta SQL, no redacta cifras.
5. **Nunca inventar.** Todo resultado viaja con metadatos (`freshness`,
   `approximations`, `coverage`). Sin datos ⇒ se dice.
6. **Mínimo dato persistido.** No se guardan mensajes crudos; la auditoría guarda
   intención + parámetros normalizados + metadatos del resultado.

---

## 2. Arquitectura general (diagrama de componentes)

```
                         ┌──────────────────────────────┐
  Telegram (móvil/web/   │        Telegram Bot API       │
  desktop)  ───────────► │  (webhook HTTPS + secret)     │
                         └──────────────┬───────────────┘
                                        │ POST /telegram/webhook
┌───────────────────────────────────────▼──────────────────────────────────────┐
│                        BOT GATEWAY  (apps/bot-gateway)                        │
│                                                                              │
│  Channel Adapter (grammY) ─► Update Guard (privado, dedupe update_id,        │
│                              tamaño, idioma) ─► Rate Limiter (user/tenant)   │
│        │                                                                     │
│        ▼                                                                     │
│  Identity Resolver ─► Tenant Context Builder (membresía activa, rol,         │
│  (telegram_accounts)   permisos efectivos, conexiones, timezone)             │
│        │                                                                     │
│        ▼                                                                     │
│  Query Pipeline:                                                             │
│   1. Normalizer      (minúsculas, tildes, typos comunes, números)            │
│   2. Rule Router     (gramática + sinónimos + DateResolver) ── conf ≥ 0.85 ─┐│
│   3. LLM Router      (LLMProvider: tool-calling solo para extraer slots) ◄──┘│
│   4. Slot Validator  (zod, defaults, desambiguación, contexto de sesión)     │
│   5. Policy Engine   (permiso requerido ∈ permisos efectivos; read-only)     │
│   6. Tool Executor   (timeout, caché, circuit breaker por conexión)          │
│   7. Renderer        (plantillas HTML Telegram, formato es-PE)               │
│        │                     │                                               │
│        ▼                     ▼                                               │
│  Session Store (TTL 15m)   Audit Logger (async)   LLM Usage Meter            │
│                                                                              │
│  Admin API (/admin/v1)  — gestión de tenants, códigos, membresías, auditoría │
│  Token Signer (ES256, kid rotativo, JWKS público)                            │
└──────────────┬──────────────────────────────────────────┬────────────────────┘
               │ HTTPS + JWT corto (60 s, aud, scopes)     │
               ▼                                          ▼
┌──────────────────────────────┐          ┌───────────────────────────────────┐
│  POS HUB  (apps/pos-hub)     │          │  JAGUARES SERVER (existente)       │
│  /bi/v1/*   (solo lectura)   │          │  /api/bi/v1/*  (nuevo, read-only)  │
│  /ingest/v1/* (dispositivos) │          │  usuario MySQL solo SELECT         │
│  Postgres: read model + RLS  │          │  MySQL jaguares_db                 │
└──────────────▲───────────────┘          └───────────────────────────────────┘
               │ HTTPS + device token (revocable), lotes idempotentes
┌──────────────┴───────────────┐
│  Monterrial POS (Electron)   │
│  Postgres local (offline)    │
│  Sync Agent (nuevo módulo)   │
└──────────────────────────────┘

Bot DB (Postgres, propia del gateway): tenants, conexiones, identidades,
membresías, roles/permisos, códigos de vinculación, sesiones, auditoría, uso LLM.
```

### Qué vive dónde

| Dato | Dónde | Por qué |
|---|---|---|
| Tenants, conexiones, cuentas Telegram, membresías, permisos, auditoría del bot | **Bot DB** | Es el *control plane*; no existe en los sistemas origen |
| Ventas, inventario, fiado | **POS local** (verdad operativa) → **POS Hub** (réplica analítica) | El POS sigue offline-first; el Hub solo agrega |
| Alumnos, pagos, inscripciones | **Jaguares MySQL** | Ya está en la nube; no se replica |
| Usuarios internos de POS/Jaguares | En cada sistema; el bot guarda solo `external_user_ref` opcional | Evitar duplicar identidades y contraseñas |

---

## 3. ¿Unified Business API? Recomendación

Evalué tres opciones:

| Opción | Pros | Contras |
|---|---|---|
| A. Bot → BD de cada sistema | Rápido | Viola seguridad. **Descartada.** |
| B. Bot → *Unified BI API* (servicio aparte) → APIs de sistemas | Un punto único | Un salto de red más, otro servicio que asegurar y desplegar, sin consumidores adicionales hoy |
| **C. Bot con capa de conectores interna + API BI por sistema con contrato común** | Mismo aislamiento, menos piezas, contrato reutilizable | El "núcleo de consultas" vive dentro del gateway |

**Recomiendo C.** La "API unificada" es en realidad el paquete
`packages/query-core` (registro de herramientas + conectores + políticas), que es
una librería. Cuando aparezca WhatsApp u otro canal, ese paquete se reutiliza en
otro adaptador de canal, o se extrae como servicio si hay consumidores externos
(fase 3). Construir B hoy es complejidad sin beneficio.

Cada sistema expone su API BI con **el mismo contrato**: mismo esquema de JWT,
mismo sobre de respuesta (`ToolResult`), mismos códigos de error. Eso es lo que
permite agregar `FarmaciaConnector` o `GimnasioConnector` sin tocar el bot.

---

## 4. Flujo de autenticación / vinculación

### 4.1 Emisión del código

```
Operador/Owner (panel o bot)           Bot Gateway                    Bot DB
        │  POST /admin/v1/link-codes      │                              │
        │  {membershipTemplate: rol,      │                              │
        │   tenant (del token admin)}     │                              │
        │────────────────────────────────►│ code = random 128 bits       │
        │                                 │ (base64url, 22 chars)        │
        │                                 │ guarda SHA-256(code),        │
        │                                 │ exp = +10 min, uses = 1 ────►│
        │◄──── deep-link t.me/Bot?start=<code>  + QR + código manual 8c  │
```

- Deep-link: `https://t.me/<bot>?start=<code>` (Telegram permite hasta 64 chars
  `[A-Za-z0-9_-]`).
- Código manual alternativo (`ABCD-2345`, alfabeto sin ambigüedades): 8 chars,
  ~40 bits, **válido solo combinado con límite de 5 intentos por cuenta/hora**.
- En BD solo se guarda el **hash**; el código no contiene información del tenant.
- Estados: `pending → consumed | expired | revoked`.

### 4.2 Canje

```
Usuario abre deep-link ──► /start <code>
  1. Solo chats privados (chat.type === 'private'); en grupos se ignora.
  2. Rate limit de canje por telegram_user_id.
  3. Buscar hash; validar pending, no expirado; UPDATE ... WHERE status='pending'
     (atómico, evita doble canje).
  4. Upsert telegram_account(telegram_user_id, username, first_name).
  5. Crear membership(account → tenant, rol del código, status=active).
  6. Auditoría: link.consumed. Notificar al emisor ("Juan vinculó su Telegram").
  7. Responder: "Listo, Carlos. Ya puedes consultar Bodega San Martín."
```

### 4.3 Quién genera códigos en el MVP

El POS es de escritorio y a veces está offline, y Jaguares no tiene un panel
pensado para esto. Para no bloquear el MVP:

1. **Tú (operador SaaS)** creas el tenant y el código del *owner* con la Admin API
   (CLI o un panel mínimo).
2. **El owner invita a su equipo desde el bot**: `/invitar` → elige rol → recibe
   un deep-link para reenviar. Requiere permiso `members.manage`.
3. **Fase 2**: botón "Conectar Telegram" en el panel web de Monterrial/Jaguares,
   que llama a la Admin API server-to-server.

### 4.4 Gestión

| Acción | Dónde | Permiso |
|---|---|---|
| Listar miembros | `/miembros` en bot, Admin API | `members.read` |
| Cambiar rol / permisos | Admin API, bot (fase 2) | `members.manage` |
| Revocar / bloquear | `/miembros` → botón Revocar, Admin API | `members.manage` |
| Ver sesiones y última actividad | Admin API | `members.read` |
| Auto-desvincularse | `/salir` | ninguno |

La revocación es inmediata: el *Tenant Context Builder* consulta la membresía en
cada mensaje (caché local máx. 30 s, invalidada al revocar).

### 4.5 Riesgo: robo de la cuenta de Telegram

Telegram identifica la **cuenta**, no a la persona. Mitigaciones:
- Recomendar 2FA de Telegram en el onboarding.
- Revisión periódica: membresías sin actividad en 90 días pasan a `dormant`.
- Fase 2: PIN opcional por tenant para herramientas sensibles (listas de
  deudores, finanzas) con ventana de 12 h.
- Aviso: los chats con bots **no tienen cifrado de extremo a extremo**; los
  mensajes quedan en servidores de Telegram. Se informa en `/privacidad`.

---

## 5. Flujo de una consulta

```
"¿Cuánto vendimos este mes comparado con septiembre?"
 │
 ├─ Update Guard: privado ✓, update_id no visto ✓, ≤ 500 chars ✓
 ├─ Rate limit: user 3/20 ✓, tenant 11/100 ✓
 ├─ Identity: tg 123456789 → account a1 → membership m7 (tenant T, rol owner)
 ├─ Context: {tenant T, conexiones [pos:tienda-centro], tz America/Lima,
 │            permisos {sales.read, inventory.read, ...}}
 ├─ Normalizer: "cuanto vendimos este mes comparado con septiembre"
 ├─ Rule Router: intent=pos.sales_summary (0.93), period=this_month,
 │               compare=explicit(2026-09)  → no se llama al LLM
 ├─ DateResolver(tz): [2026-10-01T05:00Z, 2026-10-04T14:47Z) MTD
 │                    compare: [2026-09-01T05:00Z, 2026-10-01T05:00Z)
 ├─ Policy: sales.read ∈ permisos ✓ ; tool.kind = read ✓
 ├─ Executor: JWT{sub:m7, ten:T, conn:pos-1, scp:[sales.read], aud:pos-hub, exp:60s}
 │            GET pos-hub/bi/v1/sales/summary?from&to&compareFrom&compareTo
 ├─ Resultado: {status:ok, data:{...}, meta:{freshness: 09:42, approximations:[]}}
 ├─ Renderer: plantilla sales_summary
 ├─ Session: last={intent: pos.sales_summary, slots}, TTL 15 min
 └─ Audit (async): {tenant, membership, intent, tool, params, rows:1, 182 ms, ok}
```

Latencia objetivo: p95 < 1.5 s por regla, < 3 s con LLM.

---

## 6. Diseño multi-tenant

```
Tenant (empresa/cliente que paga)
 ├── Connection: pos  · tienda "Centro"   (external_ref = storeId)
 ├── Connection: pos  · tienda "Norte"
 └── Connection: jaguares · "Escuela Jaguares" (external_ref = base URL/instancia)

TelegramAccount ──< Membership >── Tenant
                       │
                       ├── role (owner/admin/employee/accounting)
                       ├── overrides (grant/deny de permisos)
                       └── connection_scope (todas | lista de conexiones)
```

- Una cuenta de Telegram puede pertenecer a **varios tenants** (p. ej. tu cuenta o
  un contador). `/empresa` cambia el tenant activo (guardado en sesión). Si tiene
  uno solo, es implícito.
- Varias tiendas: el slot `store` se resuelve **solo contra las conexiones que la
  membresía puede ver**. Sin slot ⇒ todas las permitidas (con desglose por tienda).
- "Consulta el tenant 456" ⇒ no existe ningún camino para ese parámetro: el router
  no tiene slot de tenant, el LLM no lo conoce y la API exige el `ten` del JWT.

### Comparación de mecanismos de aislamiento

| Mecanismo | Uso recomendado |
|---|---|
| **JWT firmado por el gateway (ES256, 60 s, `aud`, `scp`, `ten`, `jti`)** | Entre gateway y APIs BI. Asimétrico: comprometer una API no permite emitir tokens. **Principal.** |
| **RLS en Postgres del POS Hub** (`SET LOCAL app.store_ids = ...` en cada transacción, rol `bi_reader` sin `BYPASSRLS`) | Defensa en profundidad: aunque un endpoint olvide el filtro, la BD lo aplica. |
| API keys estáticas | Solo para la ingesta de dispositivos, y como *device tokens* individuales, hasheados y revocables. Nunca una clave global. |
| Supabase `service_role` | **Evitar** en rutas de consulta: ignora RLS. Si se usa Supabase, usarlo como Postgres con roles propios. |
| Firma HMAC de peticiones | Innecesaria si hay JWT corto + TLS; útil solo para webhooks entrantes. |
| mTLS | Fase 3 / clientes enterprise. |

---

## 7. Sistema de permisos

### 7.1 Catálogo (granular, extensible por conector)

| Permiso | Cubre |
|---|---|
| `sales.read` | Totales, conteos, ticket promedio, ventas por día |
| `sales.products.read` | Ranking y ventas por producto |
| `payments.read` | Ventas/cobros por método de pago |
| `inventory.read` | Stock, stock bajo, agotados |
| `receivables.read` | Total fiado (agregado) |
| `receivables.list` | Nombres de deudores y montos (PII) |
| `cash.read` | Turnos/caja (fase 2) |
| `margin.read` | Costos/utilidad (fase 2) |
| `students.read` | Conteos de alumnos, disciplinas, matrículas |
| `students.finance.read` | Ingresos, pagos pendientes (agregado) |
| `students.debt.list` | Nombres de alumnos con deuda (PII de menores) |
| `attendance.read` | Asistencias (fase 2) |
| `reports.export` | PDF/Excel (fase 2) |
| `members.read` / `members.manage` | Gestión de accesos al bot |

### 7.2 Roles plantilla

| Rol | Permisos |
|---|---|
| owner | todos |
| admin | todos excepto `members.manage` (configurable) |
| accounting | `sales.read`, `payments.read`, `receivables.*`, `students.finance.read`, `margin.read`, `reports.export` |
| employee | `inventory.read`, `sales.products.read` |

### 7.3 Cálculo de permisos efectivos

```
efectivos = (rol.permisos ∪ grants) − denies
            ∩ permisos soportados por las conexiones de la membresía
            ∩ permisos habilitados por el plan del tenant
```

Cada herramienta declara `requiredPermissions`. El *Policy Engine* lo comprueba
**después** de que el router eligió la herramienta y **antes** de llamarla. Si falla:
*"No tienes permiso para consultar información financiera."* (mensaje por
categoría, sin nombrar la herramienta ni el sistema interno).

---

## 8. Estrategia offline / sincronización de Monterrial

### 8.1 El problema

El POS es la fuente de verdad y funciona sin Internet; el bot vive en Internet.
Hoy no hay réplica central de ventas (hallazgo P1) y la BD cloud está expuesta
(P2).

### 8.2 Opciones

| Opción | Veredicto |
|---|---|
| Bot consulta la PC del negocio (túnel) | Depende de que la PC esté encendida; abre la red del cliente. **No.** |
| POS escribe directo a la BD cloud con `CLOUD_DATABASE_URL` | Es el problema actual. **No.** |
| Replicación lógica Postgres → cloud | Exige conectividad/credenciales de BD en cada PC y replica todo el esquema. **No.** |
| **Outbox/cursor local → API de ingesta autenticada → read model analítico** | Offline intacto, credencial revocable por dispositivo, solo se sube lo necesario. **Sí.** |

### 8.3 Diseño recomendado

```
POS local (Postgres)                               POS Hub (nube)
┌─────────────────────────────┐                   ┌──────────────────────────┐
│ Checkout (sin cambios)      │                   │ POST /ingest/v1/batches  │
│                             │                   │  auth: device token      │
│ Sync Agent (proceso Electron)│  HTTPS, gzip      │  valida store ↔ device   │
│  cada 60 s si hay red:      │ ───────────────►  │  upsert idempotente      │
│  SELECT ... WHERE           │  lotes ≤ 500 filas│  por id (cuid global)    │
│   (updated_at, id) > cursor │ ◄───────────────  │  devuelve nuevo cursor   │
│  (con ventana de solape)    │   ack + cursor    │  recalcula daily rollups │
│ guarda cursor local         │                   │  RLS por store_id        │
└─────────────────────────────┘                   └──────────────────────────┘
```

- **Cursor por `(updatedAt, id)` en vez de outbox transaccional** para el MVP:
  no toca `checkout/route.ts` (código sensible con hallazgos abiertos) y captura
  las anulaciones porque también cambian `updatedAt`. Solape de 5 min para tolerar
  relojes y transacciones lentas; el Hub es idempotente.
- **Fase 2**: outbox transaccional (`sync_outbox` escrito dentro del checkout) si
  se detectan huecos o se necesitan eliminaciones físicas.
- Entidades sincronizadas: `Sale` (cabecera + splits normalizados), `SaleItem`
  (campos de reporte), `ReceivablePayment`, `Receivable` (saldo), `StoreProduct`
  (stock, minStock, precio, activo) + nombre de producto. **No** se suben clientes
  completos (solo nombre y saldo para fiado), ni datos farmacéuticos de pacientes.
- **Credencial por dispositivo**: al activar el sync, el owner vincula la PC con
  un código (mismo patrón que Telegram); el Hub emite un device token
  (opaco, hash en BD, revocable, rotación anual). Si la PC se roba, se revoca.
- **Frescura visible**: cada respuesta del POS incluye
  `meta.freshness = última sincronización de esa tienda`. Si pasaron más de
  30 min: *"⚠️ Datos sincronizados hasta las 09:42; la caja podría tener ventas
  más recientes."*
- **Multi-PC por tienda**: cada dispositivo tiene su cursor; el Hub deduplica por
  `sale.id`.

> [!IMPORTANT]
> Requisito previo: retirar `CLOUD_DATABASE_URL` de las distribuciones y rotar
> esas credenciales. El login cloud debe pasar a un endpoint HTTP del backend.
> Es un cambio en `marketPOS`, fuera de este repo, pero bloquea la confianza en
> cualquier dato central.

### 8.4 Read model del Hub (no replica el esquema del POS)

Tablas con forma analítica (`sales_fact`, `sale_item_fact`, `payment_fact`,
`receivable_snapshot`, `stock_snapshot`, `daily_sales_rollup`). Las fechas
locales (`local_date` en la zona horaria de la tienda) se calculan al ingerir, lo
que vuelve triviales "ventas por día" y "mejor día". Detalle en doc 02 §6.

---

## 9. Integración con Jaguares

**Recomendación:** `Bot → JaguaresConnector → Jaguares /api/bi/v1/* → MySQL`.

- Endpoints nuevos en `server/index.js` (convención del repo), agrupados y
  protegidos por un middleware `verificarTokenBot` que valida el JWT del gateway
  con la clave pública (JWKS cacheado), `aud = jaguares:<instancia>`, y `scp`.
- **Pool MySQL aparte** con un usuario `bi_reader` con `GRANT SELECT` solo sobre
  vistas `bi_*` que excluyen PII (DNI, condición médica, URLs de documentos).
- Toda conversión de mes/año usa `global.COL_ANIO`; fechas convertidas a
  `America/Lima` en SQL (`CONVERT_TZ`) o en Node con Luxon.
- Sin caché de `node-cache` compartido con rutas públicas: caché propia del BI
  (TTL 60 s).
- Cambios de modelo recomendados antes de exponer métricas: `fecha_cancelacion`
  en `inscripciones` (retiros) y decisión sobre deuda (ver doc 02 §3.2).

---

## 10. Estrategia de seguridad (resumen)

| Capa | Control |
|---|---|
| Entrada Telegram | Webhook con `secret_token` (header `X-Telegram-Bot-Api-Secret-Token`), ruta no adivinable, solo chats privados, dedupe por `update_id`, límite de longitud, ignorar media en fase 1 |
| Identidad | Membresía activa obligatoria; revocación inmediata; códigos hasheados de un uso |
| Autorización | Policy Engine en gateway + scopes en JWT + RLS en Hub + usuario SQL de solo `SELECT` |
| Prompt injection | El LLM solo puede devolver una herramienta de una lista permitida para el usuario y slots validados por zod; no tiene herramientas de tenant, SQL ni texto libre ejecutable. El texto del usuario nunca se concatena en SQL |
| SQL injection | Consultas parametrizadas (Prisma/`$queryRaw` con *tagged templates*, `mysql2` con `?`). Nombres de producto buscados con parámetros y `ILIKE`/trigram |
| Fuga de datos | Plantillas con lista blanca de campos; errores genéricos al usuario; `pino` con `redact`; nunca loguear tokens ni respuestas completas |
| Secretos | Variables de entorno gestionadas en el orquestador (Dokploy/Docker secrets); `.env` fuera de git; claves de firma con `kid` y rotación trimestral; JWKS publica 2 claves durante la transición |
| En tránsito | TLS en todo; HSTS en Admin API |
| En reposo | Cifrado de disco del proveedor; columnas sensibles del bot (username, nombre) mínimas; backups cifrados |
| Abuso / costos | Rate limit por usuario/tenant/global, presupuesto diario de LLM por tenant, circuit breaker del proveedor |
| Escritura futura | `kind: 'write'` requiere confirmación explícita con botón, permiso `*.write`, idempotency key y auditoría reforzada; deshabilitado por flag global en fase 1 |

---

## 11. Recomendación de stack

| Pieza | Elección | Justificación |
|---|---|---|
| Lenguaje | TypeScript estricto, Node 22 LTS | Tu ecosistema |
| HTTP | **Fastify** | Ligero, rápido, esquemas, buen soporte TS. NestJS añade DI/decoradores que no necesitamos para 2 servicios |
| Telegram | **grammY** | TS-first, mantenido, middlewares, sesiones, webhooks con Fastify, plugins de rate-limit y conversación. Mejor tipado que Telegraf |
| Validación | **zod** | Una sola definición para slots, contratos HTTP y esquemas JSON de tool-calling (`zod-to-json-schema`) |
| ORM | **Prisma** (Bot DB y Hub) | Conocido por ti; `$queryRaw` tipado para agregaciones |
| BD | **PostgreSQL 16** | Puede ser Supabase como Postgres gestionado, sin usar `service_role` ni PostgREST para este tráfico |
| Fechas | **Luxon** | Zonas IANA, aritmética de calendario |
| Dinero | `decimal.js` + strings en JSON | Evitar `number` |
| Logs | **pino** + redact | Estructurado, barato |
| Errores | Sentry | Opcional pero recomendado |
| Redis | **No en el MVP** | Un solo proceso: rate limit y caché en memoria; sesiones en Postgres. Se introduce al pasar a ≥ 2 réplicas (rate limit distribuido, caché compartida, cola de reportes) |
| Colas | No en el MVP | Reportes (fase 2) con BullMQ cuando exista Redis |
| Monorepo | **pnpm workspaces** | 2 apps + paquetes compartidos, sin Nx/Turborepo |
| Tests | Vitest + Testcontainers (Postgres) | Rápido, nativo TS |

---

## 12. Estructura de carpetas

```
bottelegram/
├── docs/                         # esta propuesta
├── apps/
│   ├── bot-gateway/
│   │   ├── prisma/schema.prisma  # Bot DB (control plane)
│   │   └── src/
│   │       ├── main.ts
│   │       ├── config/           # carga y valida env con zod
│   │       ├── channels/telegram/  # grammY: handlers, comandos, teclados, render HTML
│   │       ├── identity/         # telegram_accounts, link codes, membresías
│   │       ├── tenancy/          # TenantContext builder, selección de empresa
│   │       ├── authz/            # catálogo de permisos, roles, PolicyEngine
│   │       ├── pipeline/         # normalizer, rule-router, llm-router, slot-validator
│   │       ├── session/          # contexto conversacional con TTL
│   │       ├── rendering/        # plantillas por herramienta, formato es-PE
│   │       ├── security/         # rate limiter, token signer (JWKS), update guard
│   │       ├── audit/            # audit logger, consultas de auditoría
│   │       ├── admin-api/        # /admin/v1/*
│   │       └── observability/    # logger, métricas, health
│   └── pos-hub/
│       ├── prisma/schema.prisma  # read model analítico + dispositivos
│       └── src/
│           ├── ingest/           # /ingest/v1, device tokens, upsert idempotente
│           ├── bi/               # /bi/v1, consultas agregadas
│           ├── auth/             # verificación JWT del gateway, RLS context
│           └── rollups/          # daily_sales_rollup
├── packages/
│   ├── contracts/                # zod: ToolResult, DTOs BI, errores, claims JWT
│   ├── query-core/               # ToolRegistry, ToolDefinition, Connector, executor
│   ├── connectors/
│   │   ├── monterrial-pos/       # cliente HTTP del POS Hub + herramientas pos.*
│   │   └── jaguares/             # cliente HTTP de Jaguares BI + herramientas jag.*
│   ├── date-resolver/            # expresiones de fecha en español + zona horaria
│   ├── llm/                      # LLMProvider + OpenAI/Anthropic/Gemini/DeepSeek
│   └── nlu-es/                   # normalización, sinónimos, gramática de intents
├── integrations/                 # código a portar a otros repos (no se despliega aquí)
│   ├── marketpos-sync-agent/     # módulo para desktop/src de marketPOS
│   └── jaguares-bi-routes/       # middleware + rutas /api/bi/v1 para server/index.js
├── docker/                       # Dockerfiles y compose de desarrollo
├── pnpm-workspace.yaml
└── AGENTS.md
```

`integrations/` permite desarrollar y testear aquí lo que finalmente se integra en
`marketPOS` y `jaguares-cms-dev` (que son repos separados con sus propias reglas).
