#!/bin/sh
# Build usado pelo Vercel (ver vercel.json).
set -e

# 1) Build: backend (prisma generate + tsc → backend/dist) e frontend (→ frontend/dist)
npm run build

# 2) Migrations do banco (cria/atualiza as tabelas)
node scripts/migrate.mjs
