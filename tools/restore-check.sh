#!/usr/bin/env bash
# QUALITY QA7: una vez al mes, restaurar un volcado semanal en una rama de Neon y comparar los
# conteos de filas con los que tenía la base al volcarla. Corre en tu máquina, no en GitHub: la
# clave privada de age la guardas tú (ADR-017).
#
# Requisitos: age, docker (para pg_restore y psql de Postgres 17) y la CLI `neon` con sesión.
#
# Uso:
#   1. Baja el artifact `respaldo-…` de la última corrida de "Respaldo semanal" (GitHub ›
#      Actions) y descomprímelo: trae `estudio-AAAA-MM-DD.dump.age` y su `.counts.txt`.
#   2. tools/restore-check.sh <clave-privada-age> <estudio-AAAA-MM-DD.dump.age>
#
# Crea la rama `restore-check-<fecha>` desde `production` (vence en un día por si algo falla),
# restaura el volcado en una base nueva y vacía de esa rama (`restore_check`), compara y borra
# la rama. TARGET_URL=<url> restaura en esa base en lugar de crear una rama (para probar el
# script sin tocar Neon).
set -euo pipefail
# Git Bash en Windows: que no convierta en rutas los argumentos que empiezan con "/".
export MSYS_NO_PATHCONV=1

KEY=${1:?"Uso: $0 <clave-privada-age> <estudio-AAAA-MM-DD.dump.age>"}
ARCHIVE=${2:?"Uso: $0 <clave-privada-age> <estudio-AAAA-MM-DD.dump.age>"}
COUNTS=${ARCHIVE%.dump.age}.counts.txt
PROJECT=${NEON_PROJECT_ID:-noisy-lake-92120665}
PARENT=${NEON_PARENT_BRANCH:-production}
DATABASE=restore_check
ROOT=$(cd "$(dirname "$0")/.." && pwd)
PG=(docker run -i --rm postgres:17)

for tool in age docker; do
  command -v "$tool" >/dev/null || { echo "Falta $tool" >&2; exit 1; }
done
[ -f "$COUNTS" ] || { echo "Falta $COUNTS: viene en el mismo artifact que el volcado" >&2; exit 1; }

WORK=$(mktemp -d)
BRANCH=""
cleanup() {
  rm -rf "$WORK"
  if [ -n "$BRANCH" ]; then
    neon branches delete "$BRANCH" --project-id "$PROJECT" >/dev/null && echo "Rama $BRANCH borrada"
  fi
}
trap cleanup EXIT

age --decrypt --identity "$KEY" --output "$WORK/estudio.dump" "$ARCHIVE"

TARGET=${TARGET_URL:-}
if [ -z "$TARGET" ]; then
  BRANCH="restore-check-$(date -u +%Y%m%d%H%M)"
  EXPIRES=$(date -u -d '+1 day' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+1d +%Y-%m-%dT%H:%M:%SZ)
  neon branches create --project-id "$PROJECT" --name "$BRANCH" --parent "$PARENT" \
    --expires-at "$EXPIRES" --no-secrets >/dev/null
  neon databases create --project-id "$PROJECT" --branch "$BRANCH" --name "$DATABASE" >/dev/null
  TARGET=$(neon connection-string "$BRANCH" --project-id "$PROJECT" --database-name "$DATABASE")
  echo "Restaurando en la base $DATABASE de la rama $BRANCH"
fi

# Como en el workflow: un aviso menor de pg_restore no invalida la copia; la juzgan los conteos.
"${PG[@]}" pg_restore --no-owner --no-privileges --dbname="$TARGET" <"$WORK/estudio.dump" \
  || echo "pg_restore informó errores; se juzga por los conteos" >&2
"${PG[@]}" psql "$TARGET" -At -v ON_ERROR_STOP=1 <"$ROOT/.github/backup/row-counts.sql" | tr -d '\r' >"$WORK/restored.txt"

missing=$(comm -23 <(tr -d '\r' <"$COUNTS" | sort) <(sort "$WORK/restored.txt"))
if [ -n "$missing" ]; then
  echo "La copia restaurada no coincide en:" >&2
  echo "$missing" >&2
  exit 1
fi
echo "Restauración correcta: coinciden $(grep -c . "$COUNTS") tablas con el volcado de $(basename "$ARCHIVE" .dump.age)"
