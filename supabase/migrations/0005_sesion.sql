-- 0005_sesion: funciones para armar la sesión del servidor.
-- security definer: el propietario no tiene política de select sobre propietario_usuarios
-- y la pantalla /dev-login corre sin usuario (app.uid() nulo).

-- Usuario de app.uid(), sólo si está activo, con sus propietarios ligados.
create function app.sesion_actual()
returns table (usuario_id uuid, email text, rol rol_usuario, propietario_ids uuid[])
language sql stable security definer
set search_path = public, pg_temp
as $$
  select u.id, u.email, u.rol,
    coalesce(
      (select array_agg(pu.propietario_id order by pu.propietario_id)
         from propietario_usuarios pu where pu.usuario_id = u.id),
      '{}'::uuid[])
  from usuarios u
  where u.id = app.uid() and u.activo
$$;

-- Usuarios activos para /dev-login. Guarda en BD: sin filas salvo que la base tenga
-- app.dev_login = 'on' (lo fija scripts/db-local.sh sólo en bases locales).
create function app.usuarios_dev_login()
returns table (id uuid, email text, nombre text, rol rol_usuario)
language sql stable security definer
set search_path = public, pg_temp
as $$
  select id, email, nombre, rol from usuarios
  where activo and current_setting('app.dev_login', true) = 'on'
  order by rol, email
$$;

revoke execute on function app.sesion_actual(), app.usuarios_dev_login() from public;
grant execute on function app.sesion_actual() to app_server, authenticated;
grant execute on function app.usuarios_dev_login() to app_server;
