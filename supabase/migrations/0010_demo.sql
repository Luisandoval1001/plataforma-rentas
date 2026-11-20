-- 0010_demo: interruptor de /dev-login guardado en la base.
-- En Supabase el rol postgres no puede fijar parámetros propios (app.dev_login) con
-- ALTER DATABASE/ROLE, así que el interruptor también vive en una tabla que sólo el dueño
-- puede leer o escribir. Sin el renglón ('dev_login','on') —y sin el parámetro local—
-- app.usuarios_dev_login() no devuelve filas: una base de producción nunca lista usuarios.

create table app.configuracion (
  clave text primary key,
  valor text not null
);
alter table app.configuracion enable row level security;
revoke all on app.configuracion from public;

create or replace function app.usuarios_dev_login()
returns table (id uuid, email text, nombre text, rol rol_usuario)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select id, email, nombre, rol from usuarios
  where activo
    and (current_setting('app.dev_login', true) = 'on'
         or exists (select 1 from app.configuracion c where c.clave = 'dev_login' and c.valor = 'on'))
  order by rol, email
$$;
