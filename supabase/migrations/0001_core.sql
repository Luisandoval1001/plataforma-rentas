-- 0001_core: esquema base (usuarios, propietarios, inmuebles, unidades, inquilinos, contratos) y RLS.
-- No crea el esquema auth: localmente lo provee supabase/local/auth_shim.sql; en Supabase ya existe.

-- ============================================================
-- Enums
-- ============================================================
create type rol_usuario as enum ('admin', 'equipo', 'propietario');
create type modelo_dinero as enum ('cobra_disa', 'cobra_propietario');
create type tipo_inmueble as enum ('departamento', 'casa', 'edificio', 'local', 'terreno', 'nave', 'otro');
create type estatus_contrato as enum ('pendiente_firma', 'vigente', 'terminado');

-- ============================================================
-- Tablas
-- ============================================================
create table usuarios (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  nombre text not null,
  rol rol_usuario not null,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table propietarios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  rfc text,
  modelo modelo_dinero not null,
  comision_pct numeric(5,2) not null default 0
    check (comision_pct >= 0 and comision_pct <= 100),
  cuenta_ultimos4 text,
  recargo_visible boolean not null default false,
  recargos_al_propietario boolean not null default false,
  idioma text not null default 'es' check (idioma in ('es', 'en')),
  avisos_pago boolean not null default true,
  avisos_estado_cuenta boolean not null default true,
  avisos_contrato boolean not null default true,
  contacto_email text,
  contacto_tel text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table propietario_usuarios (
  propietario_id uuid not null references propietarios (id) on delete cascade,
  usuario_id uuid not null references usuarios (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (propietario_id, usuario_id)
);
create index propietario_usuarios_usuario_idx on propietario_usuarios (usuario_id);

create table inmuebles (
  id uuid primary key default gen_random_uuid(),
  propietario_id uuid not null references propietarios (id),
  nombre text not null,
  direccion text,
  tipo tipo_inmueble not null,
  cobrador_id uuid references usuarios (id),
  created_at timestamptz not null default now()
);
create index inmuebles_propietario_idx on inmuebles (propietario_id);

create table unidades (
  id uuid primary key default gen_random_uuid(),
  inmueble_id uuid not null references inmuebles (id),
  propietario_id uuid not null references propietarios (id),  -- derivado de inmuebles (trigger)
  nombre text not null,
  created_at timestamptz not null default now()
);
create index unidades_propietario_idx on unidades (propietario_id);
create index unidades_inmueble_idx on unidades (inmueble_id);

create table inquilinos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  email text,
  telefono text,
  rfc text,
  created_at timestamptz not null default now()
);

create table contratos (
  id uuid primary key default gen_random_uuid(),
  unidad_id uuid not null references unidades (id),
  propietario_id uuid not null references propietarios (id),  -- derivado de unidades (trigger)
  inquilino_id uuid not null references inquilinos (id),
  fecha_inicio date not null,
  fecha_fin date not null,
  renta_mensual numeric(12,2) not null,
  dia_pago smallint not null check (dia_pago between 1 and 28),
  deposito numeric(12,2) not null default 0,
  incremento_anual_pct numeric(5,2) not null default 0,
  estatus estatus_contrato not null default 'vigente',
  pendiente_firma_desde date,
  contrato_origen_id uuid references contratos (id),
  pdf_path text,
  created_at timestamptz not null default now(),
  check (fecha_fin >= fecha_inicio)
);
create index contratos_propietario_idx on contratos (propietario_id);
create index contratos_unidad_idx on contratos (unidad_id);

-- ============================================================
-- Funciones (esquema app)
-- ============================================================
create schema if not exists app;

-- Usuario de la petición: el `sub` de request.jwt.claims, que la app fija por transacción
-- (src/lib/db.ts) y que PostgREST fija para un JWT de Supabase. Misma lógica que auth.uid(),
-- pero propia: en Supabase el rol postgres no puede dar a app_server acceso al esquema auth.
create function app.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function app.rol_actual() returns rol_usuario
language sql stable security definer
set search_path = public, pg_temp
as $$
  select rol from usuarios where id = app.uid()
$$;

create function app.mis_propietarios() returns setof uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select propietario_id from propietario_usuarios where usuario_id = app.uid()
$$;

-- Triggers de propietario_id derivado. security definer para que RLS no oculte
-- el renglón padre ni filtre la propagación a los hijos.
create function app.tg_unidades_propietario() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  select propietario_id into new.propietario_id from inmuebles where id = new.inmueble_id;
  return new;
end
$$;

create function app.tg_contratos_propietario() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  select propietario_id into new.propietario_id from unidades where id = new.unidad_id;
  return new;
end
$$;

create function app.tg_inmuebles_propaga() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update unidades set propietario_id = new.propietario_id where inmueble_id = new.id;
  return null;
end
$$;

create function app.tg_unidades_propaga() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update contratos set propietario_id = new.propietario_id where unidad_id = new.id;
  return null;
end
$$;

create trigger unidades_propietario
  before insert or update of inmueble_id, propietario_id on unidades
  for each row execute function app.tg_unidades_propietario();

create trigger contratos_propietario
  before insert or update of unidad_id, propietario_id on contratos
  for each row execute function app.tg_contratos_propietario();

create trigger inmuebles_propaga
  after update of propietario_id on inmuebles
  for each row when (old.propietario_id is distinct from new.propietario_id)
  execute function app.tg_inmuebles_propaga();

create trigger unidades_propaga
  after update of propietario_id on unidades
  for each row when (old.propietario_id is distinct from new.propietario_id)
  execute function app.tg_unidades_propaga();

-- ============================================================
-- Grants (RLS decide qué renglones)
-- ============================================================
grant usage on schema app to app_server, authenticated;

revoke execute on function app.uid(), app.rol_actual(), app.mis_propietarios() from public;
grant execute on function app.uid(), app.rol_actual(), app.mis_propietarios() to app_server, authenticated;

revoke execute on function
  app.tg_unidades_propietario(), app.tg_contratos_propietario(),
  app.tg_inmuebles_propaga(), app.tg_unidades_propaga()
from public;

grant select, insert, update, delete on
  usuarios, propietarios, propietario_usuarios, inmuebles, unidades, inquilinos, contratos
to app_server, authenticated;

-- ============================================================
-- RLS
-- ============================================================
alter table usuarios enable row level security;
alter table propietarios enable row level security;
alter table propietario_usuarios enable row level security;
alter table inmuebles enable row level security;
alter table unidades enable row level security;
alter table inquilinos enable row level security;
alter table contratos enable row level security;

-- admin: todo en todas las tablas
create policy admin_todo on usuarios for all to app_server, authenticated
  using (app.rol_actual() = 'admin') with check (app.rol_actual() = 'admin');
create policy admin_todo on propietarios for all to app_server, authenticated
  using (app.rol_actual() = 'admin') with check (app.rol_actual() = 'admin');
create policy admin_todo on propietario_usuarios for all to app_server, authenticated
  using (app.rol_actual() = 'admin') with check (app.rol_actual() = 'admin');
create policy admin_todo on inmuebles for all to app_server, authenticated
  using (app.rol_actual() = 'admin') with check (app.rol_actual() = 'admin');
create policy admin_todo on unidades for all to app_server, authenticated
  using (app.rol_actual() = 'admin') with check (app.rol_actual() = 'admin');
create policy admin_todo on inquilinos for all to app_server, authenticated
  using (app.rol_actual() = 'admin') with check (app.rol_actual() = 'admin');
create policy admin_todo on contratos for all to app_server, authenticated
  using (app.rol_actual() = 'admin') with check (app.rol_actual() = 'admin');

-- equipo: select en todas
create policy equipo_select on usuarios for select to app_server, authenticated
  using (app.rol_actual() = 'equipo');
create policy equipo_select on propietarios for select to app_server, authenticated
  using (app.rol_actual() = 'equipo');
create policy equipo_select on propietario_usuarios for select to app_server, authenticated
  using (app.rol_actual() = 'equipo');
create policy equipo_select on inmuebles for select to app_server, authenticated
  using (app.rol_actual() = 'equipo');
create policy equipo_select on unidades for select to app_server, authenticated
  using (app.rol_actual() = 'equipo');
create policy equipo_select on inquilinos for select to app_server, authenticated
  using (app.rol_actual() = 'equipo');
create policy equipo_select on contratos for select to app_server, authenticated
  using (app.rol_actual() = 'equipo');

-- equipo: no modifica propietarios. Sin esta política el UPDATE de equipo afectaría
-- 0 renglones en silencio; con ella el renglón es visible pero el WITH CHECK falla
-- y Postgres lanza "new row violates row-level security policy".
create policy equipo_update_denegado on propietarios for update to app_server, authenticated
  using (app.rol_actual() = 'equipo') with check (false);

-- equipo: insert/update en inmuebles, unidades, inquilinos, contratos
create policy equipo_insert on inmuebles for insert to app_server, authenticated
  with check (app.rol_actual() = 'equipo');
create policy equipo_update on inmuebles for update to app_server, authenticated
  using (app.rol_actual() = 'equipo') with check (app.rol_actual() = 'equipo');
create policy equipo_insert on unidades for insert to app_server, authenticated
  with check (app.rol_actual() = 'equipo');
create policy equipo_update on unidades for update to app_server, authenticated
  using (app.rol_actual() = 'equipo') with check (app.rol_actual() = 'equipo');
create policy equipo_insert on inquilinos for insert to app_server, authenticated
  with check (app.rol_actual() = 'equipo');
create policy equipo_update on inquilinos for update to app_server, authenticated
  using (app.rol_actual() = 'equipo') with check (app.rol_actual() = 'equipo');
create policy equipo_insert on contratos for insert to app_server, authenticated
  with check (app.rol_actual() = 'equipo');
create policy equipo_update on contratos for update to app_server, authenticated
  using (app.rol_actual() = 'equipo') with check (app.rol_actual() = 'equipo');

-- propietario: select de lo suyo; su propio renglón de usuarios; nada de inquilinos
create policy propietario_select on usuarios for select to app_server, authenticated
  using (app.rol_actual() = 'propietario' and id = app.uid());
create policy propietario_select on propietarios for select to app_server, authenticated
  using (app.rol_actual() = 'propietario' and id in (select app.mis_propietarios()));
create policy propietario_select on inmuebles for select to app_server, authenticated
  using (app.rol_actual() = 'propietario' and propietario_id in (select app.mis_propietarios()));
create policy propietario_select on unidades for select to app_server, authenticated
  using (app.rol_actual() = 'propietario' and propietario_id in (select app.mis_propietarios()));
create policy propietario_select on contratos for select to app_server, authenticated
  using (app.rol_actual() = 'propietario' and propietario_id in (select app.mis_propietarios()));
