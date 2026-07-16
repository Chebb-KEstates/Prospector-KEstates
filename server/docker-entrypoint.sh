#!/bin/sh
set -e

echo "[entrypoint] Applying database migrations…"
npx prisma migrate deploy

echo "[entrypoint] Seeding baseline data (idempotent)…"
npx tsx prisma/seed.ts

echo "[entrypoint] Starting API server…"
exec node dist/index.js
