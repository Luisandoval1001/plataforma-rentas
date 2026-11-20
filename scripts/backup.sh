#!/usr/bin/env bash
# Respaldo de la plataforma: volcado de Postgres + archivos (bucket `archivos`) + copia remota opcional.
#
# Variables: DATABASE_ADMIN_URL (obligatoria), STORAGE_PROVIDER (local|supabase), BACKUP_DIR (def. backups),
#            STORAGE_LOCAL_ROOT (def. ./storage), RCLONE_REMOTE (p. ej. gdrive:ctdisa/respaldos-plataforma),
#            BACKUP_SKIP_ARCHIVOS=1 (omite los archivos a propósito; con STORAGE_PROVIDER=supabase, sin esto,
#            la falta del CLI `supabase` o una descarga fallida son error y no se deja ningún .sql.gz).
# DATABASE_ADMIN_URL debe ser el pooler de SESIÓN de Supabase (IPv4), no el pooler de transacciones.
#
# El volcado incluye sólo los esquemas `public` y `app` (sin dueños ni privilegios).
# RESTAURAR: ver docs/despliegue.md §11.5 (crear app_server, cargar el volcado, reaplicar-permisos.sql,
#   re-invitar usuarios en Supabase Auth y reasignar usuarios.id). Archivos:
#   Archivos locales:    tar -xzf backups/archivos-<fecha>.tar.gz
#   Archivos Supabase:   supabase storage cp -r backups/archivos-<fecha>/ ss:///archivos --experimental
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
: "${DATABASE_ADMIN_URL:?Falta DATABASE_ADMIN_URL}"
DIR="${BACKUP_DIR:-backups}"
FECHA="$(TZ=America/Mexico_City date +%Y-%m-%d-%H%M)"
mkdir -p "$DIR"

TMP="$DIR/.$FECHA.sql.gz.tmp"
trap 'rm -f "$TMP"' EXIT

PROVIDER="${STORAGE_PROVIDER:-local}"
if [ "$PROVIDER" = "supabase" ] && [ "${BACKUP_SKIP_ARCHIVOS:-}" != "1" ] && ! command -v supabase >/dev/null 2>&1; then
  echo "Error: STORAGE_PROVIDER=supabase pero no está instalado el CLI de supabase (BACKUP_SKIP_ARCHIVOS=1 para omitir)" >&2
  exit 1
fi

# Sólo los esquemas de la aplicación: auth, storage, extensions, … son de Supabase y ya existen en el
# proyecto destino (volcarlos haría fallar la restauración). Sin dueños ni privilegios: se reaplican
# con scripts/reaplicar-permisos.sql. `public` ya existe en cualquier base destino: se quitan su
# CREATE SCHEMA y su COMMENT para que el volcado cargue con ON_ERROR_STOP.
pg_dump "$DATABASE_ADMIN_URL" --schema=public --schema=app --no-owner --no-privileges \
  | sed -e '/^CREATE SCHEMA public;$/d' -e '/^COMMENT ON SCHEMA public IS /d' \
  | gzip > "$TMP"

if [ "${BACKUP_SKIP_ARCHIVOS:-}" = "1" ]; then
  echo "Archivos omitidos (BACKUP_SKIP_ARCHIVOS=1)"
else
  case "$PROVIDER" in
    supabase)
      mkdir -p "$DIR/archivos-$FECHA"
      supabase storage cp -r ss:///archivos "$DIR/archivos-$FECHA/" --experimental
      echo "Respaldo de archivos: $DIR/archivos-$FECHA/" ;;
    local)
      RAIZ="${STORAGE_LOCAL_ROOT:-./storage}"
      mkdir -p "$RAIZ"
      tar -czf "$DIR/archivos-$FECHA.tar.gz" -C "$RAIZ" .
      echo "Respaldo de archivos: $DIR/archivos-$FECHA.tar.gz" ;;
    *) echo "Error: STORAGE_PROVIDER desconocido ($PROVIDER)" >&2; exit 1 ;;
  esac
fi

mv "$TMP" "$DIR/$FECHA.sql.gz"
echo "Respaldo de base de datos: $DIR/$FECHA.sql.gz"

if command -v rclone >/dev/null 2>&1 && [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy "$DIR/" "$RCLONE_REMOTE"
  echo "Copia remota: $RCLONE_REMOTE"
else
  echo "Copia remota omitida (falta rclone o RCLONE_REMOTE)"
fi
echo "Respaldo terminado"
