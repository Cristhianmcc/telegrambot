# 🤖 Bot Empresarial de Telegram — Módulo Escuela Jaguares

Bot de Telegram **multi-tenant y de solo lectura**. Permite a dueños y directivos consultar en lenguaje natural métricas, alumnos, ingresos y cobranzas de sus negocios conectados.

> **Regla de oro del proyecto:** No se modifica ningún archivo del proyecto `jaguares-cms-dev`. El bot se conecta a la base de datos de Jaguares en modo **estrictamente de solo lectura** (`SELECT`), leyendo las deudas directamente desde la tabla `pagos_mensuales`.

---

## 🚀 Inicio Rápido

### 1. Configurar variables de entorno

Copia `.env.example` a `.env` (si aún no lo tienes):

```bash
# En c:\Users\Cris\Desktop\bottelegram\.env:
TELEGRAM_BOT_TOKEN=tu_token_de_botfather
TELEGRAM_BOT_MODE=polling

# Conexión MySQL a Jaguares
JAGUARES_DB_HOST=localhost
JAGUARES_DB_PORT=3307
JAGUARES_DB_USER=root
JAGUARES_DB_PASSWORD=rootpassword123
JAGUARES_DB_NAME=jaguares_db
DEFAULT_TIMEZONE=America/Lima
```

### 2. Ejecutar el Bot

```bash
# Modo desarrollo con recarga automática:
npm run dev

# Ejecutar pruebas unitarias (DateResolver y RuleRouter):
npm test

# Compilar TypeScript:
npm run build

# Ejecutar en producción:
npm start
```

---

## 💬 Consultas que Responde en Lenguaje Natural

El bot procesa las siguientes preguntas directamente (sin costo de LLM para preguntas estándar):

### 🎓 Resumen Ejecutivo
* *"¿Cómo está la escuela?"*
* *"¿Cómo va la escuela?"*
* *"resumen"*
* `/resumen`

### 👥 Alumnos y Disciplinas
* *"¿Cuántos alumnos tenemos actualmente?"*
* *"¿Cuántos alumnos activos tenemos?"*
* *"¿Cuántos alumnos tiene fútbol?"*
* *"¿Cuántos alumnos hay en vóley?"*

### 💰 Ingresos y Cobranzas
* *"¿Cuánto hemos cobrado este mes?"*
* *"¿Cuánto cobramos en septiembre?"*
* *"¿Cuánto ingresó hoy?"*

### 📋 Deudas y Pagos Pendientes (`pagos_mensuales`)
* *"¿Cuánto nos deben?"*
* *"¿Cuánto falta cobrar?"*
* *"¿Quiénes deben este mes?"*
* *"Lista de deudores"*
* `/deudas`

### 🏟️ Cupos y Capacidad
* *"¿Cómo están los cupos de fútbol?"*
* *"¿Cuántos cupos quedan?"*
* *"capacidad"*

---

## 🔒 Arquitectura de Seguridad
* **Solo lectura estricta:** Cualquier query que no inicie con `SELECT`, `SHOW`, `DESCRIBE` o `EXPLAIN` es interceptada y rechazada antes de tocar la base de datos.
* **Auto-detección de columnas:** Soporta tanto `año` como `anio` en la tabla `pagos_mensuales`.
* **Protección de datos:** Los montos y conteos se formatean con plantillas deterministas HTML en Soles (`S/ 18,750.00`), garantizando que la IA nunca invente números.
