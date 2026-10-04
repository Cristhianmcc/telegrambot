# 00 — Hallazgos en los sistemas actuales (antes de diseñar)

Revisión estática del 04/10/2026 sobre `marketPOS` (Monterrial POS) y
`jaguares-cms-dev`. Estos hallazgos **cambian decisiones de arquitectura**;
por eso van primero.

---

## 1. Monterrial POS

| # | Hallazgo | Evidencia | Impacto en el bot |
|---|---|---|---|
| P1 | **No existe sincronización de ventas a la nube.** Solo hay backups (S3), catálogo (`CatalogSyncQueue`) y login cloud. | `desktop/src/sync/cloudBackupSync.ts`, `src/modules/catalog/*`; no hay outbox/sync de `Sale` | El bot **no tiene hoy una fuente central** de ventas. Hay que construirla (ver doc 01 §8). |
| P2 | **El instalador de escritorio lleva `CLOUD_DATABASE_URL`** (se copia `.env` a la distribución) y el login abre un `PrismaClient` directo contra la BD cloud. | `src/app/api/auth/login/route.ts` L13-24; `agent.md` (hallazgo crítico) | Cualquier PC cliente tiene credenciales de la BD central ⇒ **esa BD no es confiable como origen aislado por tenant**. Rotar credenciales y no construir analítica allí hasta corregirlo. |
| P3 | El límite de aislamiento es `Store` (`storeId`). `User` pertenece a una tienda, roles solo `OWNER`/`CASHIER`. | `prisma/schema.prisma` L138, L205, L17 | `tenant ≠ store`: una empresa puede tener varias tiendas. El bot modela *Tenant → Conexiones (una por tienda)*. |
| P4 | Las **anulaciones** ponen `total/subtotal/tax = 0`, sin estado explícito. | `agent.md` §Modelo de datos | Toda métrica debe excluir `total <= 0`; el conteo de ventas también. Las anulaciones se detectan por `updatedAt`. |
| P5 | Pago `MIXED` guarda el desglose en `paymentDetails` JSON (`splits`). | `Sale.paymentDetails` L426 | "¿Cuánto entró por Yape?" exige **expandir splits**. Sumar `paymentMethod = 'YAPE'` daría cifras falsas. |
| P6 | `FIADO` no es dinero cobrado; los abonos van en `ReceivablePayment` con su propio método. | L656-702 | Distinguir **ventas por método** vs **cobros (caja) por método**. El bot debe preguntar o aclarar. |
| P7 | Flags `isDemo` en ventas, movimientos, clientes, cuentas. | L430, L547, L641 | Excluir siempre `isDemo = true`. |
| P8 | `StoreSettings` **no tiene zona horaria** ni moneda. | L596-628 | La zona horaria vive en el bot (`tenant_connections.timezone`, default `America/Lima`). |
| P9 | `costPrice` es opcional (producto y snapshot). | L330, L470 | "¿Cuánto ganamos?" solo se puede responder con **cobertura de costos** declarada; si es baja, decir que no hay datos. |
| P10 | Decimal en BD pero muchos cálculos pasan por `number`; reportes con redondeos. | `agent.md` | El bot debe calcular con Decimal/strings y **reconciliarse contra el reporte del POS** en tests. |
| P11 | `SaleItem.quantity` está en unidad base; la presentación en `quantityOriginal`. | `agent.md`, L507 | "Top productos por unidades" debe usar unidad base y mostrarla (p. ej. "kg"). |

## 2. Escuela Jaguares

| # | Hallazgo | Evidencia | Impacto en el bot |
|---|---|---|---|
| J1 | **MySQL**, no PostgreSQL. Monolito Express (`server/index.js`). | `schema-production.sql`, `AGENTS.md` | El conector no puede asumir Prisma/Postgres. Se integra **vía API**, no vía BD. |
| J2 | **Single-tenant**: no hay `school_id`/`tenant_id` en ninguna tabla. | schema | Hoy un despliegue = una escuela = un tenant del bot. Si vendes Jaguares a otras escuelas, cada una es otro despliegue (o habrá que migrar a multi-tenant). |
| J3 | **No existe tabla de cargos/deudas.** Solo pagos (`pagos`, `pagos_mensuales`) con estado `pendiente/confirmado/rechazado`. | L394-440 | "¿Cuánto nos deben?" **no está modelado**. "Pendiente" hoy = *comprobante subido sin verificar*. La deuda real solo puede **estimarse** (inscripciones activas × precio − pagos confirmados) y debe etiquetarse así, o crear el modelo de cargos. |
| J4 | **No hay fecha de retiro.** `inscripciones.estado = 'cancelada'` solo con `updated_at`. | L285-309 | "¿Cuántos se retiraron este mes?" sería impreciso (cualquier edición mueve `updated_at`). Recomiendo agregar `fecha_cancelacion` antes de exponerlo. |
| J5 | `pagos_mensuales.mes` es `varchar` + columna `año`/`anio` variable (`global.COL_ANIO`). | L428-429, `AGENTS.md` | El endpoint BI debe normalizar mes ⇒ número y usar `COL_ANIO`. |
| J6 | Tres orígenes de dinero: `alumnos.monto_pago` (inscripción inicial), `pagos` (matrícula/mensualidad/extra) y `pagos_mensuales`. | schema | Riesgo de **doble conteo**. Definir por escrito qué suma "ingresos" (doc 02 §3.2). |
| J7 | Zonas horarias mezcladas: `timestamp` (UTC) y `datetime` (hora local) en `pagos_mensuales.fecha_pago`. | L432 vs L399 | El endpoint BI debe convertir explícitamente a `America/Lima`. |
| J8 | Datos **muy sensibles de menores**: DNI, `condicion_medica`, fotos de DNI, apoderado. | `alumnos` L62-95 | El bot **nunca** expone estos campos. Listas de deudores: nombre + monto, con permiso específico. |

## 3. Decisiones que se derivan

1. **El bot no se conecta a ninguna BD de negocio.** Ni a la del POS (P2) ni a la de
   Jaguares (J1). Solo consume APIs BI de solo lectura con tokens firmados.
2. **Monterrial necesita un "POS Hub" en la nube** con ingesta autenticada por
   dispositivo y un *read model* analítico (P1, P2). Es la pieza más grande del MVP.
3. **Jaguares expone endpoints `/api/bi/v1/*`** dentro de su propio servidor con un
   usuario MySQL de solo lectura (J1, J2).
4. **Las respuestas con cifras se renderizan con plantillas**, no las redacta el LLM
   (P4–P6, P10). El LLM interpreta; no calcula ni redacta números.
5. Las métricas no soportadas por los datos (J3, J4, P9) se responden con
   *"no tengo información suficiente"* o se etiquetan como **estimación**.
