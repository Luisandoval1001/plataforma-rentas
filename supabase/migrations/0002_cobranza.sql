-- 0002_cobranza: cargos, pagos, aplicaciones de pago y estatus calculados (vistas).
-- El estatus nunca se guarda: se calcula en v_cargos y v_contratos.
-- Los movimientos de dinero sólo ocurren vía funciones security definer.

-- ============================================================
-- Enums
-- ============================================================
create type tipo_cargo as enum ('renta', 'recargo', 'otro');
create type cuenta_destino as enum ('disa', 'propietario');

-- ============================================================
-- Tablas
-- ============================================================
create table cargos (
  id uuid primary key default gen_random_uuid(),
  contrato_id uuid not null references contratos (id),
  propietario_id uuid not null references propietarios (id),  -- derivado de contratos (trigger)
  tipo tipo_cargo not null,
  periodo date not null,
  monto numeric(12,2) not null check (monto > 0),
  fecha_limite date not null,
  notas text,
  creado_por uuid default app.uid() references usuarios (id),
  created_at timestamptz not null default now()
);

create table pagos (
  id uuid primary key default gen_random_uuid(),
  propietario_id uuid not null references propietarios (id),
  fecha date not null,
  monto numeric(12,2) not null check (monto > 0),
  metodo text,
  referencia text not null default '',
  cuenta_destino cuenta_destino not null,
  comprobante_path text,
  registrado_por uuid references usuarios (id),
  cancelado boolean not null default false,
  cancelado_motivo text,
  cancelado_at timestamptz,
  cancelado_por uuid references usuarios (id),
  created_at timestamptz not null default now()
);

create table pago_aplicaciones (
  id uuid primary key default gen_random_uuid(),
  pago_id uuid not null references pagos (id),
  cargo_id uuid not null references cargos (id),
  monto numeric(12,2) not null check (monto > 0),
  created_at timestamptz not null default now(),
  unique (pago_id, cargo_id)
);

-- ============================================================
-- Índices
-- ============================================================
create unique index cargos_renta_periodo_uq on cargos (contrato_id, periodo) where tipo = 'renta';
create index cargos_contrato_idx on cargos (contrato_id);
create index cargos_propietario_idx on cargos (propietario_id);

create unique index pagos_referencia_uq on pagos (propietario_id, referencia)
  where referencia <> '' and not cancelado;
create index pagos_propietario_idx on pagos (propietario_id);

create index pago_aplicaciones_cargo_idx on pago_aplicaciones (cargo_id);

-- ============================================================
-- Triggers
-- ============================================================
-- propietario_id del cargo se toma del contrato (se ignora el valor del cliente).
-- No se propaga si el contrato cambia de propietario: el cargo y sus pagos son históricos.
create function app.tg_cargos_propietario() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  select propietario_id into new.propietario_id from contratos where id = new.contrato_id;
  return new;
end
$$;

create trigger cargos_propietario
  before insert or update of contrato_id, propietario_id on cargos
  for each row execute function app.tg_cargos_propietario();

-- equipo sólo edita notas directamente. Security invoker a propósito: dentro de las
-- funciones security definer current_user es el dueño de la tabla y el cambio se permite
-- (actualizar_monto_cargo); en un UPDATE directo current_user es app_server/authenticated.
create function app.tg_cargos_solo_notas() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if app.rol_actual() = 'equipo'
     and current_user <> (select pg_get_userbyid(relowner) from pg_class where oid = tg_relid)
     and (to_jsonb(new) - 'notas') is distinct from (to_jsonb(old) - 'notas') then
    raise exception 'SOLO_NOTAS';
  end if;
  return new;
end
$$;

create trigger cargos_solo_notas
  before update on cargos
  for each row execute function app.tg_cargos_solo_notas();

-- ============================================================
-- Estatus calculados (funciones puras: sin lecturas de tablas, se "inlinean" y sirven igual en
-- vistas security_invoker y en las vistas del portal)
-- ============================================================
create function app.estatus_cargo(p_monto numeric, p_pagado numeric, p_fecha_limite date) returns text
language sql stable
as $$
  select case
    when p_monto - p_pagado <= 0 then 'pagado'
    when current_date > p_fecha_limite then 'vencido'
    when p_pagado > 0 then 'parcial'
    else 'pendiente'
  end
$$;

create function app.dias_atraso(p_monto numeric, p_pagado numeric, p_fecha_limite date) returns int
language sql stable
as $$
  select case
    when p_monto - p_pagado > 0 and current_date > p_fecha_limite then current_date - p_fecha_limite
    else 0
  end
$$;

create function app.estatus_contrato(p_estatus estatus_contrato, p_fecha_fin date) returns text
language sql stable
as $$
  select case
    when p_estatus = 'pendiente_firma' then 'pendiente_firma'
    when p_estatus = 'terminado' then 'terminado'
    when p_fecha_fin < current_date then 'vencido'
    when p_fecha_fin - current_date <= 60 then 'por_vencer'
    else 'vigente'
  end
$$;

-- ============================================================
-- Vistas (security_invoker: aplican la RLS de quien consulta)
-- ============================================================
create view v_cargos with (security_invoker = true) as
with base as (
  select c.*,
         coalesce((
           select sum(pa.monto)
           from pago_aplicaciones pa
           join pagos p on p.id = pa.pago_id
           where pa.cargo_id = c.id and not p.cancelado
         ), 0)::numeric(12,2) as pagado
  from cargos c
)
select b.*,
       (b.monto - b.pagado)::numeric(12,2) as saldo,
       app.estatus_cargo(b.monto, b.pagado, b.fecha_limite) as estatus,
       app.dias_atraso(b.monto, b.pagado, b.fecha_limite) as dias_atraso
from base b;

create view v_contratos with (security_invoker = true) as
select c.*,
       app.estatus_contrato(c.estatus, c.fecha_fin) as estatus_calc,
       i.nombre as inquilino_nombre
from contratos c
left join inquilinos i on i.id = c.inquilino_id;

-- ============================================================
-- Funciones de cobranza (security definer; sólo admin/equipo)
-- ============================================================
create function generar_cargos_renta(p_periodo date) returns int
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_periodo date;
  v_ultimo date;
  v_n int;
begin
  if app.rol_actual() is null or app.rol_actual() not in ('admin', 'equipo') then
    raise exception 'SOLO_EQUIPO';
  end if;

  v_periodo := date_trunc('month', p_periodo)::date;
  v_ultimo := (v_periodo + interval '1 month' - interval '1 day')::date;

  insert into cargos (contrato_id, tipo, periodo, monto, fecha_limite)
  select c.id, 'renta', v_periodo, c.renta_mensual, v_periodo + (c.dia_pago - 1)
  from contratos c
  where c.estatus = 'vigente'
    and c.fecha_inicio <= v_ultimo
    and c.fecha_fin >= v_periodo
  on conflict (contrato_id, periodo) where tipo = 'renta' do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end
$$;

create function registrar_pago(
  p_cargo_ids uuid[],
  p_monto numeric,
  p_fecha date,
  p_metodo text,
  p_referencia text,
  p_cuenta cuenta_destino,
  p_comprobante_path text
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_propietarios int;
  v_propietario uuid;
  v_encontrados int;
  v_pago uuid;
  v_restante numeric(12,2);
  v_cargo record;
  v_saldo numeric(12,2);
  v_aplicar numeric(12,2);
begin
  if app.rol_actual() is null or app.rol_actual() not in ('admin', 'equipo') then
    raise exception 'SOLO_EQUIPO';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'MONTO_INVALIDO';
  end if;
  if p_cargo_ids is null or cardinality(p_cargo_ids) = 0 then
    raise exception 'CARGOS_REQUERIDOS';
  end if;

  -- Bloquea los cargos para que dos pagos simultáneos no excedan el saldo.
  perform 1 from cargos where id = any (p_cargo_ids) order by id for update;

  select count(*), count(distinct propietario_id), min(propietario_id::text)::uuid
    into v_encontrados, v_propietarios, v_propietario
  from cargos where id = any (p_cargo_ids);

  if v_encontrados <> (select count(distinct x) from unnest(p_cargo_ids) x) then
    raise exception 'CARGO_NO_ENCONTRADO';
  end if;
  if v_propietarios > 1 then
    raise exception 'CARGOS_DE_VARIOS_PROPIETARIOS';
  end if;

  insert into pagos (propietario_id, fecha, monto, metodo, referencia, cuenta_destino,
                     comprobante_path, registrado_por)
  values (v_propietario, coalesce(p_fecha, current_date), p_monto, p_metodo,
          coalesce(p_referencia, ''), p_cuenta, p_comprobante_path, app.uid())
  returning id into v_pago;

  v_restante := p_monto;
  for v_cargo in
    select c.id, c.monto
    from unnest(p_cargo_ids) with ordinality as t(cargo_id, orden)
    join cargos c on c.id = t.cargo_id
    order by t.orden
  loop
    exit when v_restante <= 0;

    select v_cargo.monto - coalesce(sum(pa.monto), 0) into v_saldo
    from pago_aplicaciones pa
    join pagos p on p.id = pa.pago_id
    where pa.cargo_id = v_cargo.id and not p.cancelado;

    continue when v_saldo <= 0;

    v_aplicar := least(v_saldo, v_restante);
    insert into pago_aplicaciones (pago_id, cargo_id, monto)
    values (v_pago, v_cargo.id, v_aplicar);
    v_restante := v_restante - v_aplicar;
  end loop;

  if v_restante > 0 then
    raise exception 'MONTO_EXCEDE_SALDO';
  end if;

  return v_pago;
end
$$;

create function cancelar_pago(p_pago_id uuid, p_motivo text) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_cancelado boolean;
begin
  if app.rol_actual() is null or app.rol_actual() not in ('admin', 'equipo') then
    raise exception 'SOLO_EQUIPO';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'MOTIVO_REQUERIDO';
  end if;

  select cancelado into v_cancelado from pagos where id = p_pago_id for update;
  if not found then
    raise exception 'PAGO_NO_ENCONTRADO';
  end if;
  if v_cancelado then
    raise exception 'PAGO_CANCELADO';
  end if;

  update pagos
     set cancelado = true,
         cancelado_motivo = btrim(p_motivo),
         cancelado_at = now(),
         cancelado_por = app.uid()
   where id = p_pago_id;
end
$$;

create function actualizar_monto_cargo(p_cargo_id uuid, p_monto numeric) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if app.rol_actual() is null or app.rol_actual() not in ('admin', 'equipo') then
    raise exception 'SOLO_EQUIPO';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'MONTO_INVALIDO';
  end if;

  perform 1 from cargos where id = p_cargo_id for update;
  if not found then
    raise exception 'CARGO_NO_ENCONTRADO';
  end if;

  -- Cuentan sólo aplicaciones de pagos vigentes: si el pago se canceló, el monto puede corregirse.
  if exists (
    select 1 from pago_aplicaciones pa join pagos p on p.id = pa.pago_id
    where pa.cargo_id = p_cargo_id and not p.cancelado
  ) then
    raise exception 'CARGO_CON_PAGOS';
  end if;

  update cargos set monto = p_monto where id = p_cargo_id;
end
$$;

-- ============================================================
-- Grants (RLS decide qué renglones)
-- ============================================================
revoke execute on function app.tg_cargos_propietario(), app.tg_cargos_solo_notas() from public;

revoke execute on function
  generar_cargos_renta(date),
  registrar_pago(uuid[], numeric, date, text, text, cuenta_destino, text),
  cancelar_pago(uuid, text),
  actualizar_monto_cargo(uuid, numeric)
from public;
grant execute on function
  generar_cargos_renta(date),
  registrar_pago(uuid[], numeric, date, text, text, cuenta_destino, text),
  cancelar_pago(uuid, text),
  actualizar_monto_cargo(uuid, numeric)
to app_server, authenticated;

grant select, insert, update, delete on cargos to app_server, authenticated;
-- Pagos y aplicaciones sólo se leen directamente: el dinero se mueve únicamente vía
-- registrar_pago / cancelar_pago (security definer), para nadie — admin incluido.
grant select on pagos, pago_aplicaciones to app_server, authenticated;

revoke execute on function
  app.estatus_cargo(numeric, numeric, date),
  app.dias_atraso(numeric, numeric, date),
  app.estatus_contrato(estatus_contrato, date)
from public;
grant execute on function
  app.estatus_cargo(numeric, numeric, date),
  app.dias_atraso(numeric, numeric, date),
  app.estatus_contrato(estatus_contrato, date)
to app_server, authenticated;

grant select on v_cargos, v_contratos to app_server, authenticated;

-- ============================================================
-- RLS
-- ============================================================
alter table cargos enable row level security;
alter table pagos enable row level security;
alter table pago_aplicaciones enable row level security;

-- admin: todo
create policy admin_todo on cargos for all to app_server, authenticated
  using (app.rol_actual() = 'admin') with check (app.rol_actual() = 'admin');
-- pagos / pago_aplicaciones: admin sólo lee (sin privilegio de escritura; ver Grants)
create policy admin_select on pagos for select to app_server, authenticated
  using (app.rol_actual() = 'admin');
create policy admin_select on pago_aplicaciones for select to app_server, authenticated
  using (app.rol_actual() = 'admin');

-- equipo: select en todo
create policy equipo_select on cargos for select to app_server, authenticated
  using (app.rol_actual() = 'equipo');
create policy equipo_select on pagos for select to app_server, authenticated
  using (app.rol_actual() = 'equipo');
create policy equipo_select on pago_aplicaciones for select to app_server, authenticated
  using (app.rol_actual() = 'equipo');

-- equipo: inserta recargos y otros cargos (la renta la genera generar_cargos_renta)
create policy equipo_insert on cargos for insert to app_server, authenticated
  with check (app.rol_actual() = 'equipo' and tipo in ('recargo', 'otro'));

-- equipo: update de cargos limitado a notas (lo hace cumplir el trigger cargos_solo_notas;
-- el monto se cambia con actualizar_monto_cargo)
create policy equipo_update on cargos for update to app_server, authenticated
  using (app.rol_actual() = 'equipo') with check (app.rol_actual() = 'equipo');

-- propietario: sin políticas directas (vistas del portal en una tarea posterior)
