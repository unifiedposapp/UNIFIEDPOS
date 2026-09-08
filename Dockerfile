# syntax=docker/dockerfile:1
# Multi-stage production image for the Unified POS monorepo.
# Ships the Express API *and* the built React SPA in one image (the server
# serves the SPA and the /api under a single origin). Portable: runs on any
# Docker host (Render, Railway, Fly.io, a VPS, AWS ECS, Cloud Run...).

# ─── Base ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false
# openssl + libc6-compat are required by Prisma's query engine on Alpine.
RUN apk add --no-cache openssl libc6-compat

# ─── Dependencies ────────────────────────────────────────────────────────
FROM base AS deps
# Copy manifests first for better layer caching.
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/server/package.json ./packages/server/
COPY packages/web/package.json ./packages/web/
# `npm ci` for fully reproducible installs from the committed package-lock.json.
# If the lockfile ever drifts from package.json this fails loudly (in CI and here)
# rather than silently resolving different versions — regenerate with `npm install`
# and commit the updated lock.
RUN npm ci

# ─── Builder ─────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 1) Generate Prisma client (needed for server TS types)
# 2) Build shared → server → web
# 3) Drop dev dependencies from the tree shipped to runtime
# 4) Regenerate the Prisma client into the pruned tree so the runtime engine is present
RUN npx prisma generate --schema=packages/server/prisma/schema.prisma \
 && npm run build:shared \
 && npm run build:server \
 && npm run build:web \
 && npm prune --omit=dev \
 && npx prisma generate --schema=packages/server/prisma/schema.prisma

# ─── Runtime ─────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
# Non-root runtime user.
RUN addgroup -S nodejs -g 1001 && adduser -S posapp -u 1001 -G nodejs

COPY --from=builder --chown=posapp:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=posapp:nodejs /app/package.json ./package.json
COPY --from=builder --chown=posapp:nodejs /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder --chown=posapp:nodejs /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder --chown=posapp:nodejs /app/packages/server/package.json ./packages/server/package.json
COPY --from=builder --chown=posapp:nodejs /app/packages/server/dist ./packages/server/dist
COPY --from=builder --chown=posapp:nodejs /app/packages/server/prisma ./packages/server/prisma
COPY --from=builder --chown=posapp:nodejs /app/packages/web/package.json ./packages/web/package.json
COPY --from=builder --chown=posapp:nodejs /app/packages/web/dist ./packages/web/dist
COPY --chown=posapp:nodejs docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV WEB_DIST=/app/packages/web/dist \
    PORT=3001
EXPOSE 3001

# Liveness check against the /api/health probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 || exit 1

USER posapp
ENTRYPOINT ["docker-entrypoint.sh"]
