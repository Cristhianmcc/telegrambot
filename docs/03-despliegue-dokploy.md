# Guía de Despliegue en Dokploy (VPS)

Esta guía explica paso a paso cómo desplegar el **Bot Empresarial de Telegram** en tu VPS usando **Dokploy**.

---

## 1. Requisitos Previos en Dokploy

1. Tener Dokploy instalado y funcionando en tu VPS.
2. Subir este repositorio `bottelegram` a tu cuenta de GitHub o GitLab (privado).

---

## 2. Crear la Aplicación en Dokploy

1. En el panel de **Dokploy**, ve a tu **Project** y haz clic en **Create Service** $\rightarrow$ **Application**.
2. Asígnale un nombre, por ejemplo: `bot-telegram-jaguares`.
3. En la sección **Source**:
   - Selecciona **GitHub** (o Git).
   - Elige tu repositorio `bottelegram` y la rama `main` (o `master`).
4. En la sección **Build Type**:
   - Selecciona **Dockerfile** (el proyecto ya incluye un [`Dockerfile`](file:///c:/Users/Cris/Desktop/bottelegram/Dockerfile) multi-stage optimizado en `node:22-alpine`).

---

## 3. Configurar Variables de Entorno (Environment)

En la pestaña **Environment** de tu aplicación en Dokploy, pega las siguientes variables:

```env
NODE_ENV=production

# Token de tu Bot de Telegram (obtenido de @BotFather)
TELEGRAM_BOT_TOKEN=8927791196:...

# Nombre de usuario de tu bot en Telegram
TELEGRAM_BOT_USERNAME=Monterrial_bot

# Proveedor de Inteligencia Artificial (DeepSeek)
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://api.deepseek.com

# Base de datos de Jaguares (MySQL)
# NOTA: Si la BD está en el mismo VPS, usa la IP pública o el host correspondiente
JAGUARES_DB_HOST=127.0.0.1
JAGUARES_DB_PORT=3307
JAGUARES_DB_USER=root
JAGUARES_DB_PASSWORD=tu_password
JAGUARES_DB_NAME=jaguares_db
```

---

## 4. Persistencia de Clientes y Licencias (Volumen)

Para que los clientes vinculados y los códigos de activación no se borren cuando Dokploy actualice el contenedor:

1. Ve a la pestaña **Volumes** (o **Mounts**) en Dokploy.
2. Agrega un nuevo volumen:
   - **Type**: Volume
   - **Host / Volume Name**: `bottelegram_data`
   - **Container Path**: `/app/data`
3. Guarda los cambios.

---

## 5. Desplegar

Haz clic en **Deploy** en la esquina superior derecha de Dokploy.
En los logs verás:

```text
🐆 Iniciando Bot Empresarial de Telegram (Módulo Escuela Jaguares)...
🧠 LLM activado: DeepSeek (https://api.deepseek.com)
✅ Conexión a base de datos de Jaguares (MySQL) verificada exitosamente.
🚀 Bot de Telegram iniciado en modo polling.
🤖 Bot autenticado como @Monterrial_bot
```

---

## 6. Cómo Generar Nuevos Accesos para Vender

Cuando un nuevo cliente compre el servicio, puedes generar su acceso de dos formas:

### Opción A (Desde la terminal de tu Dokploy o VPS):
Entra a la terminal del contenedor o ejecútalo con:
```bash
npm run client:create -- --tenant=jaguares --name="Escuela Deportiva Jaguares" --role=owner
```

### Opción B (Comando directo en el bot):
El bot te generará un enlace como:
> `https://t.me/Monterrial_bot?start=ACT-JAG-XXXXX`

Se lo envías por WhatsApp al cliente $\rightarrow$ hace clic en **Iniciar** $\rightarrow$ ¡y listo! Su cuenta de Telegram queda vinculada de inmediato.
