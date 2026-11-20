-- 0003_dinero: gastos, liquidaciones (estados de cuenta al propietario), sus líneas y ajustes pendientes.
-- Las liquidaciones sólo se crean/modifican vía funciones security definer; una vez cerradas son
-- inmutables (las correcciones posteriores entran como ajustes_pendientes en la siguiente).

-- ============================================================
-- Enums
-- ============================================================
create type pagado_por as enum ('disa', 'propietario');
create type estatus_liquidacion as enum ('borrador', 'cerrada', 'pagada');

-- ============================================================
-- Tablas
-- ============================================================
create table gastos (
  id uuid primary key default gen_random_uuid(),
  propietario_id uuid not null references propietarios (id),  -- derivado de inmuebles (trigger)
  inmueble_id uuid not null references inmuebles (id),
  unidad_id uuid references unidades (id),
  fecha date not null,
  concepto text not null,
  monto numeric(12,2) not null check (monto > 0),
  comprobante_path text,
  pagado_por pagado_por not null,
  autorizado_por text,
  registrado_por uuid default app.uid() references usuarios (id),
  created_at timestamptz not null default now()
);
create index gastos_propietario_fecha_idx on gastos (propietario_id, fecha);
create index gastos_inmueble_idx on gastos (inmueble_id);

create table liquidaciones (
  id uuid primary key default gen_random_uuid(),
  propietario_id uuid not null references propietarios (id),
  periodo date not null check (periodo = date_trunc('month', periodo)::date),
  estatus estatus_liquidacion not null default 'borrador',
  modelo modelo_dinero not null,
  comision_pct numeric(5,2) not null,
  cobrado numeric(12,2) not null default 0,
  comision numeric(12,2) not null default 0,
  iva numeric(12,2) not null default 0,
  gastos_disa numeric(12,2) not null default 0,
  gastos_propietario numeric(12,2) not null default 0,
  ajustes numeric(12,2) not null default 0,
  neto numeric(12,2) not null default 0,
  cerrada_at timestamptz,
  cerrada_por uuid references usuarios (id),
  pagada_at timestamptz,
  pago_fecha date,
  pago_referencia text,
  pago_comprobante_path text,
  pdf_path text,
  created_at timestamptz not null default now(),
  unique (propietario_id, periodo)
);

create table liquidacion_lineas (
  id uuid primary key default gen_random_uuid(),
  liquidacion_id uuid not null references liquidaciones (id),
  tipo text not null check (tipo in ('cobro', 'gasto_disa', 'gasto_propietario', 'ajuste')),
  referencia_id uuid,
  descripcion text not null,
  monto numeric(12,2) not null,
  created_at timestamptz not null default now()
);
create index liquidacion_lineas_liquidacion_idx on liquidacion_lineas (liquidacion_id);
create index liquidacion_lineas_referencia_idx on liquidacion_lineas (referencia_id);

create table ajustes_pendientes (
  id uuid primary key default gen_random_uuid(),
  propietario_id uuid not null references propietarios (id),
  monto numeric(12,2) not null,
  descripcion text not null,
  origen_pago_id uuid references pagos (id),
  aplicado_en uuid references liquidaciones (id),
  created_at timestamptz not null default now()
);
create index ajustes_pendientes_propietario_idx on ajustes_pendientes (propietario_id)
  where aplicado_en is null;

-- ============================================================
-- Triggers
-- ============================================================
-- propietario_id del gasto se toma del inmueble (se ignora el valor del cliente);
-- la unidad, si se da, debe ser de ese inmueble.
create function app.tg_gastos_propietario() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  select propietario_id into new.propietario_id from inmuebles where id = new.inmueble_id;
  if new.unidad_id is not null
     and not exists (select 1 from unidades where id = new.unidad_id and inmueble_id = new.inmueble_id) then
    raise exception 'UNIDAD_DE_OTRO_INMUEBLE';
  end if;
  return new;
end
$$;

create trigger gastos_propietario
  before insert or update of inmueble_id, unidad_id, propietario_id on gastos
  for each row execute function app.tg_gastos_propietario();

-- Sólo admin borra gastos. Con un trigger (y no sólo RLS) equipo recibe un error explícito
-- en lugar de "0 renglones" silenciosos.
create function app.tg_gastos_solo_admin_borra() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if app.rol_actual() is distinct from 'admin' then
    raise exception 'SOLO_ADMIN';
  end if;
  return old;
end
$$;

create trigger gastos_solo_admin_borra
  before delete on gastos
  for each row execute function app.tg_gastos_solo_admin_borra();

-- Candado transaccional por propietario que serializa cierres de liquidación contra cancelaciones
-- de pago y ediciones de gastos: sin él, un cancelar_pago simultáneo a un cierre podría no ver la
-- liquidación cerrada (sin ajuste) mientras el cierre incluye el cobro cancelado.
create function app.bloquear_liquidaciones(p_propietario_id uuid) returns void
language sql
set search_path = public, pg_temp
as $$
  select pg_advisory_xact_lock(hashtextextended('liquidacion:' || p_propietario_id::text, 0))
$$;

-- Un gasto ya incluido en una liquidación cerrada/pagada no se modifica ni se borra (las
-- correcciones van con registrar_ajuste). security definer: debe ver las líneas sin RLS.
create function app.tg_gastos_liquidado() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  perform app.bloquear_liquidaciones(old.propietario_id);
  if exists (
    select 1 from liquidacion_lineas ll join liquidaciones l on l.id = ll.liquidacion_id
    where ll.tipo in ('gasto_disa', 'gasto_propietario') and ll.referencia_id = old.id
      and l.estatus in ('cerrada', 'pagada')
  ) then
    raise exception 'GASTO_LIQUIDADO';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

-- Nombre con prefijo "gastos_a_" para que corra antes que los demás triggers BEFORE de gastos.
create trigger gastos_a_liquidado
  before update or delete on gastos
  for each row execute function app.tg_gastos_liquidado();

-- Liquidación cerrada/pagada: inmutable salvo (a) la transición cerrada → pagada con sus datos
-- de pago (pagar_liquidacion) y (b) un cambio sólo de pdf_path (registrar_pdf_liquidacion).
-- Aplica a cualquier rol, incluso al dueño de la tabla.
create function app.tg_liquidaciones_inmutable() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.estatus in ('cerrada', 'pagada') then
    if tg_op = 'UPDATE' then
      if (to_jsonb(new) - 'pdf_path') = (to_jsonb(old) - 'pdf_path') then
        return new;
      end if;
      if old.estatus = 'cerrada' and new.estatus = 'pagada'
         and (to_jsonb(new) - array['estatus', 'pagada_at', 'pago_fecha', 'pago_referencia', 'pago_comprobante_path'])
           = (to_jsonb(old) - array['estatus', 'pagada_at', 'pago_fecha', 'pago_referencia', 'pago_comprobante_path']) then
        return new;
      end if;
    end if;
    raise exception 'LIQUIDACION_INMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger liquidaciones_inmutable
  before update or delete on liquidaciones
  for each row execute function app.tg_liquidaciones_inmutable();

-- Líneas de una liquidación cerrada/pagada: no se insertan, cambian ni borran.
create function app.tg_liquidacion_lineas_inmutable() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from liquidaciones l
    where l.estatus in ('cerrada', 'pagada')
      and l.id in (
        case when tg_op in ('UPDATE', 'DELETE') then old.liquidacion_id end,
        case when tg_op in ('INSERT', 'UPDATE') then new.liquidacion_id end
      )
  ) then
    raise exception 'LIQUIDACION_INMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger liquidacion_lineas_inmutable
  before insert or update or delete on liquidacion_lineas
  for each row execute function app.tg_liquidacion_lineas_inmutable();

-- ============================================================
-- Funciones de liquidación (security definer)
-- ============================================================
-- Reconstruye las líneas y totales de un borrador (lo usan preparar y cerrar). Interna: sin
-- execute para clientes. El llamador debe tener el renglón bloqueado y en 'borrador'.
-- Regla de selección para el periodo P (último día pL): todo cobro/gasto con fecha <= pL que no
-- esté ya en una liquidación cerrada/pagada; así lo registrado tarde entra al siguiente periodo
-- abierto. Ajustes: los pendientes sin aplicar.
create function app.reconstruir_liquidacion(p_id uuid) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_propietario uuid;
  v_periodo date;
  v_fin date;
  v_modelo modelo_dinero;
  v_pct numeric(5,2);
  v_recargos boolean;
  v_cobrado numeric(12,2);
  v_gastos_disa numeric(12,2);
  v_gastos_prop numeric(12,2);
  v_ajustes numeric(12,2);
  v_comision numeric(12,2);
  v_iva numeric(12,2);
  v_neto numeric(12,2);
begin
  select propietario_id, periodo into v_propietario, v_periodo from liquidaciones where id = p_id;
  v_fin := (v_periodo + interval '1 month')::date;  -- exclusivo: fecha < v_fin  ⇔  fecha <= pL

  -- Serializa por propietario: dos cierres simultáneos no pueden incluir el mismo cobro/gasto/ajuste.
  perform app.bloquear_liquidaciones(v_propietario);

  select modelo, comision_pct, recargos_al_propietario
    into v_modelo, v_pct, v_recargos
  from propietarios where id = v_propietario;

  delete from liquidacion_lineas where liquidacion_id = p_id;

  -- Cobros: una línea por aplicación de pago vigente, aún no liquidada.
  insert into liquidacion_lineas (liquidacion_id, tipo, referencia_id, descripcion, monto)
  select p_id, 'cobro', pa.id,
         format('%s %s %s — pago %s',
                case c.tipo when 'renta' then 'Renta' else 'Recargo' end,
                un.nombre, to_char(c.periodo, 'YYYY-MM'), to_char(p.fecha, 'YYYY-MM-DD')),
         pa.monto
  from pago_aplicaciones pa
  join pagos p on p.id = pa.pago_id
  join cargos c on c.id = pa.cargo_id
  join contratos ct on ct.id = c.contrato_id
  join unidades un on un.id = ct.unidad_id
  where c.propietario_id = v_propietario
    and not p.cancelado
    and p.fecha < v_fin
    and (c.tipo = 'renta' or (c.tipo = 'recargo' and v_recargos))
    and not exists (
      select 1 from liquidacion_lineas ll join liquidaciones l on l.id = ll.liquidacion_id
      where ll.tipo = 'cobro' and ll.referencia_id = pa.id and l.estatus in ('cerrada', 'pagada')
    )
  order by p.fecha, pa.created_at;

  -- Gastos aún no liquidados.
  insert into liquidacion_lineas (liquidacion_id, tipo, referencia_id, descripcion, monto)
  select p_id,
         case g.pagado_por when 'disa' then 'gasto_disa' else 'gasto_propietario' end,
         g.id,
         format('%s — %s%s (%s)', g.concepto, i.nombre, coalesce(' ' || un.nombre, ''),
                to_char(g.fecha, 'YYYY-MM-DD')),
         g.monto
  from gastos g
  join inmuebles i on i.id = g.inmueble_id
  left join unidades un on un.id = g.unidad_id
  where g.propietario_id = v_propietario
    and g.fecha < v_fin
    and not exists (
      select 1 from liquidacion_lineas ll join liquidaciones l on l.id = ll.liquidacion_id
      where ll.tipo in ('gasto_disa', 'gasto_propietario') and ll.referencia_id = g.id
        and l.estatus in ('cerrada', 'pagada')
    )
  order by g.fecha, g.created_at;

  -- Ajustes pendientes.
  insert into liquidacion_lineas (liquidacion_id, tipo, referencia_id, descripcion, monto)
  select p_id, 'ajuste', a.id, a.descripcion, a.monto
  from ajustes_pendientes a
  where a.propietario_id = v_propietario and a.aplicado_en is null
  order by a.created_at;

  select coalesce(sum(monto) filter (where tipo = 'cobro'), 0),
         coalesce(sum(monto) filter (where tipo = 'gasto_disa'), 0),
         coalesce(sum(monto) filter (where tipo = 'gasto_propietario'), 0),
         coalesce(sum(monto) filter (where tipo = 'ajuste'), 0)
    into v_cobrado, v_gastos_disa, v_gastos_prop, v_ajustes
  from liquidacion_lineas where liquidacion_id = p_id;

  v_comision := round(v_cobrado * v_pct / 100, 2);
  v_iva := round(v_comision * 0.16, 2);
  if v_modelo = 'cobra_disa' then
    v_neto := v_cobrado - v_comision - v_iva - v_gastos_disa + v_ajustes;
  else
    v_neto := -(v_comision + v_iva + v_gastos_disa) + v_ajustes;
  end if;

  update liquidaciones
     set modelo = v_modelo,
         comision_pct = v_pct,
         cobrado = v_cobrado,
         comision = v_comision,
         iva = v_iva,
         gastos_disa = v_gastos_disa,
         gastos_propietario = v_gastos_prop,
         ajustes = v_ajustes,
         neto = v_neto
   where id = p_id;
end
$$;

create function preparar_liquidacion(p_propietario_id uuid, p_periodo date) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_periodo date;
  v_modelo modelo_dinero;
  v_pct numeric(5,2);
  v_id uuid;
  v_estatus estatus_liquidacion;
begin
  if app.rol_actual() is null or app.rol_actual() not in ('admin', 'equipo') then
    raise exception 'SOLO_EQUIPO';
  end if;
  if p_periodo is null then
    raise exception 'PERIODO_REQUERIDO';
  end if;

  v_periodo := date_trunc('month', p_periodo)::date;

  select modelo, comision_pct into v_modelo, v_pct from propietarios where id = p_propietario_id;
  if not found then
    raise exception 'PROPIETARIO_NO_ENCONTRADO';
  end if;

  -- Crea el borrador si no existe (on conflict cubre la carrera) y lo bloquea.
  insert into liquidaciones (propietario_id, periodo, modelo, comision_pct)
  values (p_propietario_id, v_periodo, v_modelo, v_pct)
  on conflict (propietario_id, periodo) do nothing;

  select id, estatus into v_id, v_estatus
  from liquidaciones
  where propietario_id = p_propietario_id and periodo = v_periodo
  for update;

  if v_estatus <> 'borrador' then
    raise exception 'LIQUIDACION_CERRADA';
  end if;

  perform app.reconstruir_liquidacion(v_id);
  return v_id;
end
$$;

create function cerrar_liquidacion(p_id uuid) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_estatus estatus_liquidacion;
  v_incluidos int;
  v_marcados int;
begin
  if app.rol_actual() is distinct from 'admin' then
    raise exception 'SOLO_ADMIN';
  end if;

  select estatus into v_estatus from liquidaciones where id = p_id for update;
  if not found then
    raise exception 'LIQUIDACION_NO_ENCONTRADA';
  end if;
  if v_estatus <> 'borrador' then
    raise exception 'ESTATUS_INVALIDO';
  end if;

  -- Se cierra lo que hay hoy, no lo que había al preparar.
  perform app.reconstruir_liquidacion(p_id);

  -- Defensa: el candado por propietario de reconstruir_liquidacion ya evita que otro cierre
  -- aplique estos ajustes en paralelo; si ocurriera, no se aplican dos veces.
  select count(*) into v_incluidos
  from liquidacion_lineas where liquidacion_id = p_id and tipo = 'ajuste';

  update ajustes_pendientes
     set aplicado_en = p_id
   where aplicado_en is null
     and id in (select referencia_id from liquidacion_lineas where liquidacion_id = p_id and tipo = 'ajuste');
  get diagnostics v_marcados = row_count;

  if v_marcados <> v_incluidos then
    raise exception 'AJUSTE_YA_APLICADO';
  end if;

  update liquidaciones
     set estatus = 'cerrada',
         cerrada_at = now(),
         cerrada_por = app.uid()
   where id = p_id;
end
$$;

create function pagar_liquidacion(
  p_id uuid,
  p_fecha date,
  p_referencia text,
  p_comprobante_path text
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_estatus estatus_liquidacion;
begin
  if app.rol_actual() is null or app.rol_actual() not in ('admin', 'equipo') then
    raise exception 'SOLO_EQUIPO';
  end if;

  select estatus into v_estatus from liquidaciones where id = p_id for update;
  if not found then
    raise exception 'LIQUIDACION_NO_ENCONTRADA';
  end if;
  if v_estatus <> 'cerrada' then
    raise exception 'ESTATUS_INVALIDO';
  end if;

  update liquidaciones
     set estatus = 'pagada',
         pagada_at = now(),
         pago_fecha = coalesce(p_fecha, current_date),
         pago_referencia = p_referencia,
         pago_comprobante_path = p_comprobante_path
   where id = p_id;
end
$$;

create function registrar_pdf_liquidacion(p_id uuid, p_pdf_path text) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_estatus estatus_liquidacion;
begin
  if app.rol_actual() is null or app.rol_actual() not in ('admin', 'equipo') then
    raise exception 'SOLO_EQUIPO';
  end if;

  select estatus into v_estatus from liquidaciones where id = p_id for update;
  if not found then
    raise exception 'LIQUIDACION_NO_ENCONTRADA';
  end if;
  if v_estatus not in ('cerrada', 'pagada') then
    raise exception 'ESTATUS_INVALIDO';
  end if;

  update liquidaciones set pdf_path = p_pdf_path where id = p_id;
end
$$;

-- Corrección manual sobre periodos cerrados: entra como ajuste en la siguiente liquidación.
create function registrar_ajuste(p_propietario_id uuid, p_monto numeric, p_descripcion text) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if app.rol_actual() is distinct from 'admin' then
    raise exception 'SOLO_ADMIN';
  end if;
  if p_monto is null or p_monto = 0 then
    raise exception 'MONTO_INVALIDO';
  end if;
  if p_descripcion is null or btrim(p_descripcion) = '' then
    raise exception 'DESCRIPCION_REQUERIDA';
  end if;
  if not exists (select 1 from propietarios where id = p_propietario_id) then
    raise exception 'PROPIETARIO_NO_ENCONTRADO';
  end if;

  insert into ajustes_pendientes (propietario_id, monto, descripcion)
  values (p_propietario_id, p_monto, btrim(p_descripcion))
  returning id into v_id;
  return v_id;
end
$$;

-- cancelar_pago (0002) + ajuste pendiente por cada aplicación cuyo cobro ya está en una
-- liquidación cerrada/pagada, revirtiendo el efecto neto con el snapshot de esa liquidación
-- (m = monto aplicado, c = comisión, i = IVA):
--   cobra_disa: −(m − c − i)  (DISA ya entregó el neto de ese cobro)
--   cobra_propietario: +(c + i)  (se le había cobrado comisión e IVA sobre ese cobro)
-- Si el cobro sólo está en un borrador, basta con volver a prepararlo.
create or replace function cancelar_pago(p_pago_id uuid, p_motivo text) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_cancelado boolean;
  v_propietario uuid;
begin
  if app.rol_actual() is null or app.rol_actual() not in ('admin', 'equipo') then
    raise exception 'SOLO_EQUIPO';
  end if;
  if p_motivo is null or btrim(p_motivo) = '' then
    raise exception 'MOTIVO_REQUERIDO';
  end if;

  select cancelado, propietario_id into v_cancelado, v_propietario from pagos where id = p_pago_id for update;
  if not found then
    raise exception 'PAGO_NO_ENCONTRADO';
  end if;
  perform app.bloquear_liquidaciones(v_propietario);
  if v_cancelado then
    raise exception 'PAGO_CANCELADO';
  end if;

  update pagos
     set cancelado = true,
         cancelado_motivo = btrim(p_motivo),
         cancelado_at = now(),
         cancelado_por = app.uid()
   where id = p_pago_id;

  insert into ajustes_pendientes (propietario_id, monto, descripcion, origen_pago_id)
  select x.propietario_id,
         case x.modelo
           when 'cobra_disa' then -(x.m - x.c - x.i)
           else x.c + x.i
         end,
         format('Cancelación de pago %s del periodo %s: renta %s, comisión %s, IVA %s',
                x.ref, to_char(x.periodo, 'YYYY-MM'), x.m, x.c, x.i),
         x.pago_id
  from (
    select l.propietario_id, l.modelo, l.periodo, p.id as pago_id,
           coalesce(nullif(p.referencia, ''), left(p.id::text, 8)) as ref,
           pa.monto as m,
           round(pa.monto * l.comision_pct / 100, 2) as c,
           round(round(pa.monto * l.comision_pct / 100, 2) * 0.16, 2) as i,
           pa.created_at
    from pago_aplicaciones pa
    join pagos p on p.id = pa.pago_id
    join liquidacion_lineas ll on ll.tipo = 'cobro' and ll.referencia_id = pa.id
    join liquidaciones l on l.id = ll.liquidacion_id
    where pa.pago_id = p_pago_id
      and l.estatus in ('cerrada', 'pagada')
  ) x
  order by x.created_at;
end
$$;

-- ============================================================
-- Grants (RLS decide qué renglones)
-- ============================================================
revoke execute on function
  app.tg_gastos_propietario(), app.tg_gastos_solo_admin_borra(),
  app.tg_gastos_liquidado(),
  app.tg_liquidaciones_inmutable(), app.tg_liquidacion_lineas_inmutable(),
  app.reconstruir_liquidacion(uuid), app.bloquear_liquidaciones(uuid)
from public;

revoke execute on function
  preparar_liquidacion(uuid, date),
  cerrar_liquidacion(uuid),
  pagar_liquidacion(uuid, date, text, text),
  registrar_pdf_liquidacion(uuid, text),
  registrar_ajuste(uuid, numeric, text),
  cancelar_pago(uuid, text)
from public;
grant execute on function
  preparar_liquidacion(uuid, date),
  cerrar_liquidacion(uuid),
  pagar_liquidacion(uuid, date, text, text),
  registrar_pdf_liquidacion(uuid, text),
  registrar_ajuste(uuid, numeric, text),
  cancelar_pago(uuid, text)
to app_server, authenticated;

grant select, insert, update, delete on gastos to app_server, authenticated;
-- Liquidaciones, líneas y ajustes sólo se leen directamente: se escriben únicamente vía funciones,
-- para nadie — admin incluido. Sin DELETE para nadie.
grant select on liquidaciones, liquidacion_lineas, ajustes_pendientes to app_server, authenticated;

-- ============================================================
-- RLS
-- ============================================================
alter table gastos enable row level security;
alter table liquidaciones enable row level security;
alter table liquidacion_lineas enable row level security;
alter table ajustes_pendientes enable row level security;

-- gastos: admin todo; equipo select/insert/update; el DELETE de equipo lo rechaza el trigger
-- gastos_solo_admin_borra (la política existe para que el renglón llegue al trigger).
create policy admin_todo on gastos for all to app_server, authenticated
  using (app.rol_actual() = 'admin') with check (app.rol_actual() = 'admin');
create policy equipo_select on gastos for select to app_server, authenticated
  using (app.rol_actual() = 'equipo');
create policy equipo_insert on gastos for insert to app_server, authenticated
  with check (app.rol_actual() = 'equipo');
create policy equipo_update on gastos for update to app_server, authenticated
  using (app.rol_actual() = 'equipo') with check (app.rol_actual() = 'equipo');
create policy equipo_delete_denegado on gastos for delete to app_server, authenticated
  using (app.rol_actual() = 'equipo');

-- liquidaciones / líneas / ajustes: select admin y equipo (sin privilegio de escritura; ver Grants)
create policy admin_equipo_select on liquidaciones for select to app_server, authenticated
  using (app.rol_actual() in ('admin', 'equipo'));
create policy admin_equipo_select on liquidacion_lineas for select to app_server, authenticated
  using (app.rol_actual() in ('admin', 'equipo'));
create policy admin_equipo_select on ajustes_pendientes for select to app_server, authenticated
  using (app.rol_actual() in ('admin', 'equipo'));

-- propietario: sin políticas directas (vistas del portal en la Tarea 5)
