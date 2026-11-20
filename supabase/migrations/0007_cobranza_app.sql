-- 0007_cobranza_app: liga el comprobante subido por la app a un pago ya registrado.
-- pagos no tiene privilegio de escritura directa (ver 0002): esta función sólo fija comprobante_path,
-- y sólo con la ruta canónica propietarios/<propietario>/pagos/<pago>.<ext> de un pago vigente.

create function registrar_comprobante_pago(p_pago_id uuid, p_path text) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_propietario uuid;
  v_cancelado boolean;
  v_prefijo text;
begin
  if app.rol_actual() is null or app.rol_actual() not in ('admin', 'equipo') then
    raise exception 'SOLO_EQUIPO';
  end if;

  select propietario_id, cancelado into v_propietario, v_cancelado
  from pagos where id = p_pago_id for update;
  if not found then
    raise exception 'PAGO_NO_ENCONTRADO';
  end if;
  if v_cancelado then
    raise exception 'PAGO_CANCELADO';
  end if;

  v_prefijo := 'propietarios/' || v_propietario || '/pagos/' || p_pago_id || '.';
  if p_path is null
     or not starts_with(p_path, v_prefijo)
     or substr(p_path, length(v_prefijo) + 1) !~ '^[a-z0-9]{1,5}$' then
    raise exception 'RUTA_INVALIDA';
  end if;

  update pagos set comprobante_path = p_path where id = p_pago_id;
end
$$;

revoke execute on function registrar_comprobante_pago(uuid, text) from public;
grant execute on function registrar_comprobante_pago(uuid, text) to app_server, authenticated;
