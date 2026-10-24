#!/bin/sh
# ADR-018: build del servicio `api` en Vercel (buildCommand en vercel.json; corre en apps/api).
# Compila con turbo (shared, srs, cliente de Prisma y la API) y, solo en producción, aplica las
# migraciones pendientes antes de publicar: si una falla, el deploy no sale (QUALITY §5). Las
# previews no migran: su base no debe ser la de producción.
set -eu
cd ../..
pnpm turbo run build --filter=@estudio/api
if [ "${VERCEL_ENV:-}" = production ]; then
  pnpm --filter @estudio/api db:deploy
fi
