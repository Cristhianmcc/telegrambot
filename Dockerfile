# ==========================================
# Multi-stage Build para Bot Empresarial
# Optimizado para Dokploy / VPS Docker
# ==========================================

# 1. Stage de Construcción
FROM node:22-alpine AS builder

WORKDIR /app

# Copiar archivos de dependencias
COPY package*.json tsconfig.json ./

# Instalar todas las dependencias para compilar TypeScript
RUN npm ci

# Copiar código fuente
COPY src/ ./src/

# Compilar TypeScript a JavaScript estándar en dist/
RUN npm run build

# 2. Stage de Producción (Ultra ligero)
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copiar package.json y package-lock.json
COPY package*.json ./

# Instalar únicamente dependencias de producción
RUN npm ci --omit=dev && npm cache clean --force

# Copiar código compilado desde el builder
COPY --from=builder /app/dist ./dist

# Crear carpeta de datos persistente para licencias y clientes (Dokploy Volume)
RUN mkdir -p /app/data && chown -R node:node /app

# Volumen para que no se pierdan los clientes vinculados al reiniciar
VOLUME ["/app/data"]

# Ejecutar con usuario no root por seguridad
USER node

# Comando de ejecución
CMD ["node", "dist/index.js"]
