-- 0004_bitacora_docs: bitácora inmutable de movimientos, documentos, avisos enviados, usuario
-- sistema, ref_carga para la carga inicial idempotente y vistas del portal del propietario.

-- ============================================================
-- Enums
-- ============================================================
create type tipo_documento as enum ('factura', 'reporte', 'contrato', 'comprobante', 'otro');

-- ============================================================
-- Tablas
-- ============================================================
-- Sin FK a usuarios: la bitácora es inmutable y no debe impedir (ni seguir) cambios en usuarios.
create table bitacora (
  id bigserial primary key,
  tabla text not null,
  registro_id uuid,
  accion text not null check (accion in ('INSERT', 'UPDATE', 'DELETE')),
  usuario_id uuid,  -- app.uid(); nulo cuando lo ejecuta una migración o seed
  at timestamptz not null default now(),
  antes jsonb,
  despues jsonb
);
create index bitacora_registro_idx on bitacora (tabla, registro_id);
create index bitacora_at_idx on bitacora (at);

create table documentos (
  id uuid primary key default gen_random_uuid(),
  propietario_id uuid not null references propietarios (id),
  tipo tipo_documento not null,
  nombre text not null,
  path text not null,
  unidad_id uuid references unidades (id),
  pago_id uuid references pagos (id),
  liquidacion_id uuid references liquidaciones (id),
  subido_por uuid default app.uid() references usuarios (id),
  visible_propietario boolean not null default true,
  created_at timestamptz not null default now()
);
create index documentos_propietario_idx on documentos (propietario_id);
create index documentos_liquidacion_idx on documentos (liquidacion_id);

create table avisos_enviados (
  id uuid primary key default gen_random_uuid(),
  propietario_id uuid not null references propietarios (id),
  tipo text not null,
  referencia_id uuid not null,
  enviado_at timestamptz not null default now(),
  unique (tipo, referencia_id)
);
create index avisos_enviados_propietario_idx on avisos_enviados (propietario_id);

-- ref_carga: referencia externa de la carga inicial por CSV (idempotencia del piloto).
alter table propietarios add column ref_carga text unique;
alter table inmuebles add column ref_carga text unique;
alter table unidades add column ref_carga text unique;
alter table inquilinos add column ref_carga text unique;
alter table contratos add column ref_carga text unique;
alter table cargos add column ref_carga text unique;

-- ============================================================
-- Usuario sistema (cron diario y carga inicial)
-- ============================================================
insert into usuarios (id, email, nombre, rol)
values ('00000000-0000-0000-0000-000000000001', 'sistema@local', 'Sistema', 'admin')
on conflict do nothing;

-- ============================================================
-- Bitácora: triggers
-- ============================================================
-- security definer: inserta aunque el cliente no tenga privilegio sobre bitacora. app.uid() lee
-- la configuración de la sesión, así que conserva al usuario real también dentro de las funciones
-- security definer (registrar_pago, cerrar_liquidacion, …).
create function app.registrar_bitacora() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  insert into bitacora (tabla, registro_id, accion, usuario_id, antes, despues)
  values (
    tg_table_name,
    case when tg_op = 'DELETE' then old.id else new.id end,
    tg_op,
    app.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end
$$;

create trigger bitacora after insert or update or delete on pagos
  for each row execute function app.registrar_bitacora();
create trigger bitacora after insert or update or delete on pago_aplicaciones
  for each row execute function app.registrar_bitacora();
create trigger bitacora after insert or update or delete on gastos
  for each row execute function app.registrar_bitacora();
create trigger bitacora after insert or update or delete on contratos
  for each row execute function app.registrar_bitacora();
create trigger bitacora after insert or update or delete on liquidaciones
  for each row execute function app.registrar_bitacora();
create trigger bitacora after insert or update or delete on cargos
  for each row execute function app.registrar_bitacora();

-- Inmutable para cualquier rol, incluido el dueño de la tabla.
create function app.tg_bitacora_inmutable() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'BITACORA_INMUTABLE';
end
$$;

create trigger bitacora_inmutable
  before update or delete on bitacora
  for each row execute function app.tg_bitacora_inmutable();
create trigger bitacora_inmutable_truncate
  before truncate on bitacora
  for each statement execute function app.tg_bitacora_inmutable();

-- ============================================================
-- Documentos: triggers
-- ============================================================
-- equipo sólo cambia metadatos (nombre, tipo, visible_propietario).
create function app.tg_documentos_solo_metadatos() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if app.rol_actual() = 'equipo'
     and (to_jsonb(new) - array['nombre', 'tipo', 'visible_propietario'])
         is distinct from (to_jsonb(old) - array['nombre', 'tipo', 'visible_propietario']) then
    raise exception 'SOLO_METADATOS';
  end if;
  return new;
end
$$;

create trigger documentos_solo_metadatos
  before update on documentos
  for each row execute function app.tg_documentos_solo_metadatos();

-- Las ligas (unidad, pago, liquidación) deben ser del mismo propietario del documento;
-- subido_por lo fija la sesión (el cliente no lo elige). security definer: debe ver los renglones
-- ligados sin RLS.
create function app.tg_documentos_consistencia() returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' and app.uid() is not null then
    new.subido_por := app.uid();
  end if;
  if (new.unidad_id is not null and not exists (
        select 1 from unidades where id = new.unidad_id and propietario_id = new.propietario_id))
     or (new.pago_id is not null and not exists (
        select 1 from pagos where id = new.pago_id and propietario_id = new.propietario_id))
     or (new.liquidacion_id is not null and not exists (
        select 1 from liquidaciones where id = new.liquidacion_id and propietario_id = new.propietario_id)) then
    raise exception 'DOCUMENTO_DE_OTRO_PROPIETARIO';
  end if;
  return new;
end
$$;

create trigger documentos_consistencia
  before insert or update on documentos
  for each row execute function app.tg_documentos_consistencia();

-- Sólo admin borra (error explícito para equipo; mismo patrón que gastos).
create trigger documentos_solo_admin_borra
  before delete on documentos
  for each row execute function app.tg_gastos_solo_admin_borra();

-- ============================================================
-- Vistas del portal del propietario
-- ============================================================
-- Dueño: el rol de la migración (postgres). SIN security_invoker: leen las tablas con los
-- privilegios del dueño (el propietario no tiene políticas directas sobre cargos, pagos ni
-- liquidaciones), así que el filtro de cada vista es la única barrera: exige rol 'propietario'
-- y propietario_id en app.mis_propietarios(). security_barrier impide que funciones del cliente
-- se evalúen antes de ese filtro. Sólo columnas pensadas para el propietario: nunca notas,
-- creado_por, registrado_por, cerrada_por ni contacto del inquilino.
-- No se apoyan en v_cargos / v_contratos: esas vistas son security_invoker y, anidadas, se
-- evaluarían con la RLS del propietario (que no ve cargos ni inquilinos). Leen las tablas y
-- comparten el cálculo de estatus con esas vistas vía app.estatus_cargo / app.dias_atraso /
-- app.estatus_contrato (0002).

create view portal_propietario with (security_barrier = true) as
select p.id, p.nombre, p.idioma, p.avisos_pago, p.avisos_estado_cuenta, p.avisos_contrato,
       p.modelo, p.comision_pct
from propietarios p
where app.rol_actual() = 'propietario'
  and p.id in (select app.mis_propietarios());

-- Una fila por (unidad, cargo del mes en curso); la unidad sin cargos visibles este mes aparece
-- una vez con los campos del cargo en nulo (y su contrato vigente/pendiente más reciente, si hay).
-- Sólo cargos cuyo propietario es el actual de la unidad; recargos sólo con recargo_visible.
create view portal_resumen_unidades with (security_barrier = true) as
select un.propietario_id,
       i.id as inmueble_id,
       i.nombre as inmueble_nombre,
       un.id as unidad_id,
       un.nombre as unidad_nombre,
       coalesce(c.contrato_id, ca.id) as contrato_id,
       inq.nombre as inquilino_nombre,
       c.id as cargo_id,
       c.tipo,
       c.monto,
       c.fecha_limite,
       c.pagado,
       c.saldo,
       c.estatus,
       c.dias_atraso,
       (select max(pg.fecha)
          from pago_aplicaciones pa
          join pagos pg on pg.id = pa.pago_id
         where pa.cargo_id = c.id and not pg.cancelado) as ultimo_pago_fecha
from unidades un
join inmuebles i on i.id = un.inmueble_id
join propietarios p on p.id = un.propietario_id
left join lateral (
  select b.id, b.contrato_id, b.tipo, b.monto, b.fecha_limite, b.pagado,
         (b.monto - b.pagado)::numeric(12,2) as saldo,
         app.estatus_cargo(b.monto, b.pagado, b.fecha_limite) as estatus,
         app.dias_atraso(b.monto, b.pagado, b.fecha_limite) as dias_atraso
  from (
    select cg.id, cg.contrato_id, cg.tipo, cg.monto, cg.fecha_limite,
           coalesce((
             select sum(pa.monto)
             from pago_aplicaciones pa
             join pagos pg on pg.id = pa.pago_id
             where pa.cargo_id = cg.id and not pg.cancelado
           ), 0)::numeric(12,2) as pagado
    from cargos cg
    join contratos ct on ct.id = cg.contrato_id
    where ct.unidad_id = un.id
      and cg.propietario_id = un.propietario_id
      and cg.periodo = date_trunc('month', current_date)::date
      and (cg.tipo <> 'recargo' or p.recargo_visible)
  ) b
) c on true
left join lateral (
  select ct.id
  from contratos ct
  where ct.unidad_id = un.id
    and ct.propietario_id = un.propietario_id
    and ct.estatus in ('vigente', 'pendiente_firma')
  order by ct.fecha_inicio desc, ct.created_at desc
  limit 1
) ca on c.id is null
left join contratos cx on cx.id = coalesce(c.contrato_id, ca.id)
left join inquilinos inq on inq.id = cx.inquilino_id
where app.rol_actual() = 'propietario'
  and un.propietario_id in (select app.mis_propietarios());

create view portal_contratos with (security_barrier = true) as
select ct.propietario_id,
       ct.id as contrato_id,
       ct.unidad_id,
       un.nombre as unidad_nombre,
       i.nombre as inmueble_nombre,
       inq.nombre as inquilino_nombre,
       ct.fecha_inicio,
       ct.fecha_fin,
       ct.renta_mensual,
       ct.deposito,
       ct.dia_pago,
       app.estatus_contrato(ct.estatus, ct.fecha_fin) as estatus_calc,
       ct.pdf_path
from contratos ct
join unidades un on un.id = ct.unidad_id
join inmuebles i on i.id = un.inmueble_id
left join inquilinos inq on inq.id = ct.inquilino_id
where app.rol_actual() = 'propietario'
  and ct.propietario_id in (select app.mis_propietarios());

create view portal_liquidaciones with (security_barrier = true) as
select l.id, l.propietario_id, l.periodo, l.estatus, l.modelo, l.comision_pct,
       l.cobrado, l.comision, l.iva, l.gastos_disa, l.gastos_propietario, l.ajustes, l.neto,
       l.cerrada_at, l.pagada_at, l.pago_fecha, l.pago_referencia, l.pago_comprobante_path,
       l.pdf_path, l.created_at
from liquidaciones l
where l.estatus in ('cerrada', 'pagada')
  and app.rol_actual() = 'propietario'
  and l.propietario_id in (select app.mis_propietarios());

create view portal_liquidacion_lineas with (security_barrier = true) as
select ll.liquidacion_id, l.propietario_id, ll.tipo, ll.descripcion, ll.monto
from liquidacion_lineas ll
join liquidaciones l on l.id = ll.liquidacion_id
where l.estatus in ('cerrada', 'pagada')
  and app.rol_actual() = 'propietario'
  and l.propietario_id in (select app.mis_propietarios());

create view portal_documentos with (security_barrier = true) as
select d.id, d.propietario_id, d.tipo, d.nombre, d.path, d.unidad_id, d.liquidacion_id, d.created_at
from documentos d
left join liquidaciones l on l.id = d.liquidacion_id
where d.visible_propietario
  and (d.liquidacion_id is null or l.estatus in ('cerrada', 'pagada'))
  and app.rol_actual() = 'propietario'
  and d.propietario_id in (select app.mis_propietarios());

-- ============================================================
-- Grants
-- ============================================================
revoke execute on function
  app.registrar_bitacora(), app.tg_bitacora_inmutable(), app.tg_documentos_solo_metadatos(),
  app.tg_documentos_consistencia()
from public;

-- bitácora: sólo lectura (RLS: admin/equipo); se escribe únicamente vía app.registrar_bitacora.
revoke all on bitacora from public;
revoke update, delete on bitacora from public;
grant select on bitacora to app_server, authenticated;

grant select, insert, update, delete on documentos to app_server, authenticated;
grant select, insert on avisos_enviados to app_server, authenticated;

grant select on
  portal_propietario, portal_resumen_unidades, portal_contratos,
  portal_liquidaciones, portal_liquidacion_lineas, portal_documentos
to app_server, authenticated;

-- ============================================================
-- RLS
-- ============================================================
alter table bitacora enable row level security;
alter table documentos enable row level security;
alter table avisos_enviados enable row level security;

create policy admin_equipo_select on bitacora for select to app_server, authenticated
  using (app.rol_actual() in ('admin', 'equipo'));

-- documentos: admin todo; equipo select/insert/update (metadatos: trigger); el DELETE de equipo
-- lo rechaza el trigger documentos_solo_admin_borra. Propietario: sólo vía portal_documentos.
create policy admin_todo on documentos for all to app_server, authenticated
  using (app.rol_actual() = 'admin') with check (app.rol_actual() = 'admin');
create policy equipo_select on documentos for select to app_server, authenticated
  using (app.rol_actual() = 'equipo');
create policy equipo_insert on documentos for insert to app_server, authenticated
  with check (app.rol_actual() = 'equipo');
create policy equipo_update on documentos for update to app_server, authenticated
  using (app.rol_actual() = 'equipo') with check (app.rol_actual() = 'equipo');
create policy equipo_delete_denegado on documentos for delete to app_server, authenticated
  using (app.rol_actual() = 'equipo');

-- avisos_enviados: admin/equipo leen y registran (el cron y las acciones corren como admin).
create policy admin_equipo_select on avisos_enviados for select to app_server, authenticated
  using (app.rol_actual() in ('admin', 'equipo'));
create policy admin_equipo_insert on avisos_enviados for insert to app_server, authenticated
  with check (app.rol_actual() in ('admin', 'equipo'));
