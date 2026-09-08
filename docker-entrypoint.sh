#!/bin/sh
# Container entrypoint: apply committed migrations, then start the server.
set -e

SCHEMA="packages/server/prisma/schema.prisma"

# Apply migrations on boot (idempotent). Skipped when there is no migrations
# folder yet, or when SKIP_MIGRATIONS=true (e.g. you run `prisma migrate deploy`
# from CI or a one-off job instead of on every container start).
if [ "${SKIP_MIGRATIONS:-false}" != "true" ] && [ -d "packages/server/prisma/migrations" ]; then
  echo "[entrypoint] Applying Prisma migrations (migrate deploy)..."
  node node_modules/prisma/build/index.js migrate deploy --schema="$SCHEMA" \
    || echo "[entrypoint] WARNING: migrate deploy failed; starting anyway."
else
  echo "[entrypoint] Skipping migrate deploy (SKIP_MIGRATIONS=${SKIP_MIGRATIONS:-false}, migrations dir present: $([ -d packages/server/prisma/migrations ] && echo yes || echo no))."
fi

echo "[entrypoint] Starting server on port ${PORT:-3001} (NODE_ENV=${NODE_ENV:-production})..."
exec node packages/server/dist/index.js
