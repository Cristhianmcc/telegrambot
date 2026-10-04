# AGENTS.md

Bot Empresarial de Telegram, multi-tenant y **solo lectura**, para Monterrial POS
y Escuela Jaguares. Español en comentarios, logs y UI.

## Antes de cambiar algo
- Leer `docs/01-arquitectura.md` y `docs/02-contratos-y-datos.md`. Las reglas de
  negocio de métricas están en `docs/02` §3: no duplicarlas en otro sitio.
- Estado actual: solo documentación de arquitectura; no hay código todavía.

## Invariantes (no romper)
- El bot no accede a BD de negocio; solo APIs BI con JWT corto firmado por el gateway.
- Ninguna herramienta acepta `tenant_id`; el tenant sale de la membresía.
- El LLM solo devuelve `{tool, args}` de herramientas permitidas; no genera SQL ni
  redacta cifras (plantillas).
- Herramientas `kind: 'write'` prohibidas en fase 1.
- No persistir mensajes crudos; auditoría con parámetros normalizados.
- Dinero como Decimal/string; fechas con la zona horaria del tenant (Luxon).

## Repos relacionados (separados)
- `../marketPOS`: leer su `agent.md`. El Sync Agent se desarrolla en
  `integrations/marketpos-sync-agent` y se porta allí.
- `../jaguares-cms-dev`: leer su `AGENTS.md`. Rutas BI en
  `integrations/jaguares-bi-routes`, se portan a `server/index.js`; usar `global.COL_ANIO`.
