# syntax=docker/dockerfile:1

# ---- 1. Install dependencies --------------------------------------------------
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- 2. Build the standalone Next.js server -----------------------------------
FROM node:20-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- 3. Minimal runtime image -------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 --ingroup nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Seed data; replaced by the ./data bind mount under docker compose.
# The store re-seeds bots.json automatically if the mounted directory is empty.
COPY --from=builder --chown=nextjs:nodejs /app/data ./data
RUN chmod 775 /app/data

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
