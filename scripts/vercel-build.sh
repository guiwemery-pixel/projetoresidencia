#!/bin/sh
# Build usado pelo Vercel (ver vercel.json).
set -e

# 1) Migrations do banco. Usam a conexão DIRETA (sem pooler) quando existir:
#    Neon → DATABASE_URL_UNPOOLED; Supabase/Vercel Postgres → POSTGRES_URL_NON_POOLING.
MIGRATE_URL="${DATABASE_URL_UNPOOLED:-${POSTGRES_URL_NON_POOLING:-$DATABASE_URL}}"
if [ -z "$MIGRATE_URL" ]; then
  echo "ERRO: defina DATABASE_URL (conecte um banco Postgres ao projeto no Vercel)." >&2
  exit 1
fi
DATABASE_URL="$MIGRATE_URL" npx prisma migrate deploy --schema backend/prisma/schema.prisma

# 2) Build: backend (prisma generate + tsc → backend/dist) e frontend (→ frontend/dist)
npm run build
