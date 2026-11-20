-- 0009_ajustes_revision: correcciones de la revisión final antes del piloto.
--   F1  renovación activada antes del fin del contrato de origen: el origen se sigue cobrando hasta
--       su fecha_fin (y se reporta vigente/por vencer) y la renovación empieza a cobrarse después.
--   F2  cerrar_liquidacion: no se cierra el mes en curso ni uno futuro, ni fuera de orden.
--   F3  liquidación por cuenta destino: neto = cobrado en cuenta DISA − comisión − IVA − gastos DISA
--       + ajustes (comisión e IVA sobre todo lo cobrado); cobrado_disa queda guardado.
--   F4  usuarios inactivos: app.rol_actual() nulo y app.mis_propietarios() vacío.
--   F8  contratos.cargos_desde: primer día que el sistema cobra (por omisión fecha_inicio).
--   F10 portal_liquidacion_lineas expone el comprobante de las líneas de gasto.
--   F11 ajustes_pendientes.creado_por y bitácora de ajustes.
--   F12 incremento anual compuesto en contratos de varios años (app.renta_vigente).

-- ============================================================
-- F4: usuarios inactivos sin acceso a nada
-- ============================================================
create or replace function app.rol_actual() returns rol_usuario
language sql stable security definer
set search_path = public, pg_temp
as $$
  select rol from usuarios where id = app.uid() and activo
$$;

create or replace function app.mis_propietarios() returns setof uuid
language sql stable security definer
set search_path = public, pg_temp
as $$
  select pu.propietario_id
  from propietario_usuarios pu
  join usuarios u on u.id = pu.usuario_id
  where pu.usuario_id = app.uid() and u.activo
$$;

-- ============================================================
-- F12: renta vigente con incremento anual compuesto
-- ============================================================
-- Años cumplidos entre fecha_inicio y p_fecha (el año n se cumple cuando p_fecha >= fecha_inicio + n
-- años); antes del inicio, 0. Lo usan generar_cargos_renta (con p_fecha = primer día del periodo),
-- v_contratos y portal_contratos.
create function app.renta_vigente(
  p_renta numeric, p_incremento_pct numeric, p_fecha_inicio date, p_fecha date
) returns numeric
language sql stable
as $$
  select round(
    p_renta * power(1 + coalesce(p_incremento_pct, 0) / 100,
                    greatest(0, extract(year from age(p_fecha, p_fecha_inicio)))::int),
    2)::numeric(12,2)
$$;

-- ============================================================
-- F1: estatus de un contrato terminado por una renovación activada antes de su fecha_fin
-- ============================================================
create function app.estatus_contrato(
  p_estatus estatus_contrato, p_fecha_fin date, p_tiene_sucesor_vigente boolean
) returns text
language sql stable
as $$
  select case
    when p_estatus = 'terminado' and p_tiene_sucesor_vigente and p_fecha_fin >= current_date
      then app.estatus_contrato('vigente'::estatus_contrato, p_fecha_fin)
    else app.estatus_contrato(p_estatus, p_fecha_fin)
  end
$$;

-- ============================================================
-- F8: contratos.cargos_desde
-- ============================================================
alter table contratos add column cargos_desde date;

-- Por omisión fecha_inicio; si cambia fecha_inicio y cargos_desde la seguía, la sigue.
create function app.tg_contratos_cargos_desde() returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.cargos_desde := coalesce(new.cargos_desde, new.fecha_inicio);
  elsif new.cargos_desde is null
     or (new.fecha_inicio is distinct from old.fecha_inicio
         and old.cargos_desde = old.fecha_inicio
         and new.cargos_desde is not distinct from old.cargos_desde) then
    new.cargos_desde := new.fecha_inicio;
  end if;
  return new;
end
$$;

create trigger contratos_cargos_desde
  before insert or update of fecha_inicio, cargos_desde on contratos
  for each row execute function app.tg_contratos_cargos_desde();

update contratos set cargos_desde = fecha_inicio where cargos_desde is null;
alter table contratos alter column cargos_desde set not null;
alter table contratos add constraint contratos_cargos_desde_check check (cargos_desde >= fecha_inicio);

-- ============================================================
-- Vistas de contratos (F1, F12). v_contratos usa c.* y la tabla ganó una columna: se recrea.
-- ============================================================
drop view v_contratos;
create view v_contratos with (security_invoker = true) as
select c.*,
       app.estatus_contrato(c.estatus, c.fecha_fin, s.tiene_sucesor_vigente) as estatus_calc,
       i.nombre as inquilino_nombre,
       s.tiene_sucesor_vigente,
       app.renta_vigente(c.renta_mensual, c.incremento_anual_pct, c.fecha_inicio,
                         date_trunc('month', least(current_date, c.fecha_fin))::date) as renta_actual
from contratos c
left join inquilinos i on i.id = c.inquilino_id
cross join lateral (
  select exists (
    select 1 from contratos r where r.contrato_origen_id = c.id and r.estatus = 'vigente'
  ) as tiene_sucesor_vigente
) s;

create or replace view portal_contratos with (security_barrier = true) as
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
       app.estatus_contrato(ct.estatus, ct.fecha_fin, exists (
         select 1 from contratos r where r.contrato_origen_id = ct.id and r.estatus = 'vigente'
       )) as estatus_calc,
       ct.pdf_path,
       app.renta_vigente(ct.renta_mensual, ct.incremento_anual_pct, ct.fecha_inicio,
                         date_trunc('month', least(current_date, ct.fecha_fin))::date) as renta_actual
from contratos ct
join unidades un on un.id = ct.unidad_id
join inmuebles i on i.id = un.inmueble_id
left join inquilinos inq on inq.id = ct.inquilino_id
where app.rol_actual() = 'propietario'
  and ct.propietario_id in (select app.mis_propietarios());

-- ============================================================
-- Cargos de renta (F1, F8, F12)
-- ============================================================
create or replace function generar_cargos_renta(p_periodo date) returns int
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
  select c.id, 'renta', v_periodo,
         app.renta_vigente(c.renta_mensual, c.incremento_anual_pct, c.fecha_inicio, v_periodo),
         v_periodo + (c.dia_pago - 1)
  from contratos c
  where (c.estatus = 'vigente'
         -- Terminado porque su renovación se activó antes de su fecha_fin: se cobra hasta ella.
         or (c.estatus = 'terminado' and exists (
               select 1 from contratos r where r.contrato_origen_id = c.id and r.estatus = 'vigente')))
    and c.fecha_inicio <= v_ultimo
    and c.fecha_fin >= v_periodo
    and v_periodo >= date_trunc('month', c.cargos_desde)::date
    -- Una renovación no se cobra en los meses que todavía cubre su contrato de origen.
    and not exists (select 1 from contratos o where o.id = c.contrato_origen_id and o.fecha_fin >= v_periodo)
  on conflict (contrato_id, periodo) where tipo = 'renta' do nothing;

  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- ============================================================
-- F3: liquidación por cuenta destino
-- ============================================================
alter table liquidaciones add column cobrado_disa numeric(12,2) not null default 0;

create or replace function app.reconstruir_liquidacion(p_id uuid) returns void
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
  v_cobrado_disa numeric(12,2);
  v_gastos_disa numeric(12,2);
  v_gastos_prop numeric(12,2);
  v_ajustes numeric(12,2);
  v_comision numeric(12,2);
  v_iva numeric(12,2);
begin
  select propietario_id, periodo into v_propietario, v_periodo from liquidaciones where id = p_id;
  v_fin := (v_periodo + interval '1 month')::date;  -- exclusivo: fecha < v_fin  ⇔  fecha <= pL

  perform app.bloquear_liquidaciones(v_propietario);

  select modelo, comision_pct, recargos_al_propietario
    into v_modelo, v_pct, v_recargos
  from propietarios where id = v_propietario;

  delete from liquidacion_lineas where liquidacion_id = p_id;

  -- Cobros: una línea por aplicación de pago vigente, aún no liquidada, con la cuenta que la recibió.
  insert into liquidacion_lineas (liquidacion_id, tipo, referencia_id, descripcion, monto)
  select p_id, 'cobro', pa.id,
         format('%s %s %s — pago %s (%s)',
                case c.tipo when 'renta' then 'Renta' else 'Recargo' end,
                un.nombre, to_char(c.periodo, 'YYYY-MM'), to_char(p.fecha, 'YYYY-MM-DD'),
                case p.cuenta_destino when 'disa' then 'cuenta DISA' else 'cuenta propietario' end),
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

  select coalesce(sum(ll.monto), 0) into v_cobrado_disa
  from liquidacion_lineas ll
  join pago_aplicaciones pa on pa.id = ll.referencia_id
  join pagos p on p.id = pa.pago_id
  where ll.liquidacion_id = p_id and ll.tipo = 'cobro' and p.cuenta_destino = 'disa';

  v_comision := round(v_cobrado * v_pct / 100, 2);
  v_iva := round(v_comision * 0.16, 2);

  -- modelo queda como dato de referencia: el neto depende de dónde cayó cada pago.
  update liquidaciones
     set modelo = v_modelo,
         comision_pct = v_pct,
         cobrado = v_cobrado,
         cobrado_disa = v_cobrado_disa,
         comision = v_comision,
         iva = v_iva,
         gastos_disa = v_gastos_disa,
         gastos_propietario = v_gastos_prop,
         ajustes = v_ajustes,
         neto = v_cobrado_disa - v_comision - v_iva - v_gastos_disa + v_ajustes
   where id = p_id;
end
$$;

-- Ajuste por cancelación según la cuenta del pago (m = monto aplicado, c = comisión, i = IVA):
--   cuenta DISA: −(m − c − i)  (DISA ya entregó el neto de ese cobro)
--   cuenta del propietario: +(c + i)  (se le había cobrado comisión e IVA sobre ese cobro)
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
         case x.cuenta
           when 'disa' then -(x.m - x.c - x.i)
           else x.c + x.i
         end,
         format('Cancelación de pago %s del periodo %s: renta %s, comisión %s, IVA %s',
                x.ref, to_char(x.periodo, 'YYYY-MM'), x.m, x.c, x.i),
         x.pago_id
  from (
    select l.propietario_id, p.cuenta_destino as cuenta, l.periodo, p.id as pago_id,
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
-- F2: cierre sólo de meses terminados y en orden
-- ============================================================
create or replace function cerrar_liquidacion(p_id uuid) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_estatus estatus_liquidacion;
  v_periodo date;
  v_propietario uuid;
  v_incluidos int;
  v_marcados int;
begin
  if app.rol_actual() is distinct from 'admin' then
    raise exception 'SOLO_ADMIN';
  end if;

  select estatus, periodo, propietario_id into v_estatus, v_periodo, v_propietario
  from liquidaciones where id = p_id for update;
  if not found then
    raise exception 'LIQUIDACION_NO_ENCONTRADA';
  end if;
  if v_estatus <> 'borrador' then
    raise exception 'ESTATUS_INVALIDO';
  end if;
  if v_periodo >= date_trunc('month', current_date)::date then
    raise exception 'PERIODO_EN_CURSO';
  end if;
  if exists (
    select 1 from liquidaciones
    where propietario_id = v_propietario and estatus = 'borrador' and periodo < v_periodo
  ) then
    raise exception 'PERIODO_ANTERIOR_ABIERTO';
  end if;

  perform app.reconstruir_liquidacion(p_id);

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

-- ============================================================
-- Vistas del portal (F3, F10): columnas nuevas al final
-- ============================================================
create or replace view portal_liquidaciones with (security_barrier = true) as
select l.id, l.propietario_id, l.periodo, l.estatus, l.modelo, l.comision_pct,
       l.cobrado, l.comision, l.iva, l.gastos_disa, l.gastos_propietario, l.ajustes, l.neto,
       l.cerrada_at, l.pagada_at, l.pago_fecha, l.pago_referencia, l.pago_comprobante_path,
       l.pdf_path, l.created_at, l.cobrado_disa
from liquidaciones l
where l.estatus in ('cerrada', 'pagada')
  and app.rol_actual() = 'propietario'
  and l.propietario_id in (select app.mis_propietarios());

create or replace view portal_liquidacion_lineas with (security_barrier = true) as
select ll.liquidacion_id, l.propietario_id, ll.tipo, ll.descripcion, ll.monto,
       case when ll.tipo in ('gasto_disa', 'gasto_propietario') then g.comprobante_path end as comprobante_path
from liquidacion_lineas ll
join liquidaciones l on l.id = ll.liquidacion_id
left join gastos g on g.id = ll.referencia_id and ll.tipo in ('gasto_disa', 'gasto_propietario')
where l.estatus in ('cerrada', 'pagada')
  and app.rol_actual() = 'propietario'
  and l.propietario_id in (select app.mis_propietarios());

-- ============================================================
-- F11: ajustes auditados
-- ============================================================
alter table ajustes_pendientes add column creado_por uuid default app.uid() references usuarios (id);

create trigger bitacora after insert or update or delete on ajustes_pendientes
  for each row execute function app.registrar_bitacora();

-- ============================================================
-- Grants
-- ============================================================
revoke execute on function
  app.renta_vigente(numeric, numeric, date, date),
  app.estatus_contrato(estatus_contrato, date, boolean),
  app.tg_contratos_cargos_desde()
from public;
grant execute on function
  app.renta_vigente(numeric, numeric, date, date),
  app.estatus_contrato(estatus_contrato, date, boolean)
to app_server, authenticated;

grant select on v_contratos to app_server, authenticated;
