#!/bin/sh
# ADR-018: build del servicio `api` en Vercel (buildCommand en vercel.json; corre en apps/api).
# Compila con turbo (shared, srs, cliente de Prisma y la API) y empaqueta la función en
# vercel-function/main.mjs (scripts/bundle-vercel.ts), que Vercel usa tal cual (outputDirectory):
# si la empaquetara él desde src/main.ts, los paquetes CommonJS harían require de Nest 12 (solo
# ESM), que su runtime no permite.
# Solo en producción, aplica las migraciones pendientes antes de publicar: si una falla, el
# deploy no sale (QUALITY §5). Las previews no migran: su base no debe ser la de producción.
set -eu
cd ../..
pnpm turbo run build --filter=@estudio/api
pnpm --filter @estudio/api exec tsx scripts/bundle-vercel.ts
if [ "${VERCEL_ENV:-}" = production ]; then
  pnpm --filter @estudio/api db:deploy
fi
