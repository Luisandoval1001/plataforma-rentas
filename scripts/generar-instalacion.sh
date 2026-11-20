#!/usr/bin/env bash
# Genera UN archivo SQL para pegar en el SQL Editor de Supabase: crea el rol app_server,
# aplica todas las migraciones y, con --demo, carga los datos ficticios de demo/datos-demo.sql.
# Todo corre en una sola transacción: si algo falla, no queda nada a medias.
#
# Uso:  bash scripts/generar-instalacion.sh [--demo] '<clave de app_server>' > instalacion.sql
# La clave queda escrita en el archivo generado: no lo subas al repositorio.
set -euo pipefail
cd "$(dirname "$0")/.."

DEMO=0
if [ "${1:-}" = "--demo" ]; then DEMO=1; shift; fi
CLAVE="${1:?Falta la clave de app_server}"
if ! [[ "$CLAVE" =~ ^[A-Za-z0-9_-]{24,}$ ]]; then
  echo "La clave debe tener al menos 24 caracteres: letras, números, guion o guion bajo." >&2
  exit 1
fi

cat <<SQL
-- Instalación de la plataforma de rentas (generado por scripts/generar-instalacion.sh).
begin;
set local timezone = 'America/Mexico_City';

do \$\$
begin
  if to_regclass('public.propietarios') is not null then
    raise exception 'La plataforma ya está instalada en esta base: no se hizo ningún cambio.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'app_server') then
    create role app_server login password '$CLAVE';
  else
    alter role app_server login password '$CLAVE';
  end if;
end
\$\$;
grant usage on schema public to app_server;
alter role app_server set timezone = 'America/Mexico_City';

SQL

for f in supabase/migrations/*.sql; do
  printf -- '-- ===== %s =====\n' "$(basename "$f")"
  cat "$f"
  printf '\n'
done

if [ "$DEMO" = 1 ]; then
  cat <<'SQL'
-- ===== Bucket privado de archivos =====
do $$
begin
  insert into storage.buckets (id, name, public) values ('archivos', 'archivos', false)
  on conflict (id) do nothing;
exception when others then
  raise notice 'No se pudo crear el bucket archivos desde SQL (%): créalo en Storage.', sqlerrm;
end
$$;

SQL
  printf -- '-- ===== demo/datos-demo.sql =====\n'
  cat demo/datos-demo.sql
fi

cat <<'SQL'

commit;

-- Resultado: todas las filas deben decir "sí".
select 'Rol app_server puede iniciar sesión' as revision,
       case when (select rolcanlogin from pg_roles where rolname = 'app_server') then 'sí' else 'NO' end as resultado
union all
select 'app_server puede usar app.uid()',
       case when has_function_privilege('app_server', 'app.uid()', 'execute') then 'sí' else 'NO' end
union all
select 'Tablas de la plataforma creadas',
       case when (select count(*) from information_schema.tables
                  where table_schema = 'public' and table_type = 'BASE TABLE') >= 16 then 'sí' else 'NO' end
union all
select 'Bucket "archivos" existe',
       case when to_regclass('storage.buckets') is not null
                 and exists (select 1 from storage.buckets where id = 'archivos') then 'sí' else 'NO' end
union all
select 'Usuarios cargados: ' || (select count(*) from usuarios where email <> 'sistema@local'), 'sí';
SQL
