#!/bin/sh
# ADR-018: build del servicio `api` en Vercel (buildCommand en vercel.json; corre en apps/api).
# Prepara lo que la API importa (shared y srs compilados, cliente de Prisma) pero no la compila:
# el builder de Vercel la empaqueta desde src/main.ts. Si encuentra apps/api/dist/main.js, toma
# dist/ como raíz de la función, sin el "type": "module" de apps/api/package.json ni sus
# node_modules, y la función no carga ("Failed to load the ES module: /var/task/main.js").
# Solo en producción, aplica las migraciones pendientes antes de publicar: si una falla, el
# deploy no sale (QUALITY §5). Las previews no migran: su base no debe ser la de producción.
set -eu
cd ../..
pnpm turbo run build --filter=@estudio/api^...
pnpm turbo run db:generate --filter=@estudio/api
if [ "${VERCEL_ENV:-}" = production ]; then
  pnpm --filter @estudio/api db:deploy
fi
