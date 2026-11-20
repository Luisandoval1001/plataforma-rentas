#!/usr/bin/env bash
# Uso: scripts/db-local.sh start | reset <db>
# El superusuario se alcanza por el socket Unix como usuario del SO "postgres" (peer).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

psql_su() {
  if [ "$(id -u)" = "0" ]; then
    runuser -u postgres -- psql -v ON_ERROR_STOP=1 -X -q "$@"
  elif [ "$(id -un)" = "postgres" ]; then
    psql -v ON_ERROR_STOP=1 -X -q "$@"
  else
    sudo -u postgres psql -v ON_ERROR_STOP=1 -X -q "$@"
  fi
}

# Los archivos .sql deben ser legibles por el usuario postgres: se envían por stdin.
psql_su_file() {
  local db="$1" file="$2"
  psql_su -d "$db" < "$file"
}

cmd_start() {
  if ! pg_lsclusters -h | awk '{print $1, $2, $4}' | grep -q '^16 main online$'; then
    pg_ctlcluster 16 main start
  fi
  for _ in $(seq 1 30); do
    psql_su -d postgres -c 'select 1' >/dev/null 2>&1 && break
    sleep 1
  done
  psql_su -d postgres -c "alter role postgres with password 'postgres'"
  psql_su -d postgres <<'SQL'
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_server') then
    create role app_server login password 'app_server';
  end if;
end
$$;
SQL
  echo "Postgres listo (puerto 5432)"
}

cmd_reset() {
  local db="${1:?uso: db-local.sh reset <db>}"
  if [[ ! "$db" =~ ^[a-z_][a-z0-9_]*$ ]]; then
    echo "Nombre de base inválido: $db" >&2
    exit 1
  fi
  psql_su -d postgres -c "drop database if exists \"$db\" with (force)"
  psql_su -d postgres -c "create database \"$db\""
  # Sólo bases locales: habilita app.usuarios_dev_login() (pantalla /dev-login).
  psql_su -d postgres -c "alter database \"$db\" set app.dev_login = 'on'"
  # Misma zona que la app (ZONA_HORARIA en src/lib/formato.ts): current_date/now() en CDMX.
  psql_su -d postgres -c "alter database \"$db\" set timezone = 'America/Mexico_City'"
  psql_su_file "$db" supabase/local/00_roles.sql
  psql_su_file "$db" supabase/local/auth_shim.sql
  DATABASE_ADMIN_URL="postgres://postgres:postgres@localhost:5432/$db" \
    npx tsx scripts/migrate.ts
}

case "${1:-}" in
  start) cmd_start ;;
  reset) shift; cmd_reset "$@" ;;
  *) echo "Uso: $0 start | reset <db>" >&2; exit 1 ;;
esac
