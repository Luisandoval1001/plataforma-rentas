-- 0008_hardening: quita los privilegios por defecto de Supabase y deja sólo los que la aplicación usa.
-- En Supabase los privilegios por defecto otorgan ALL sobre tablas/secuencias y EXECUTE sobre funciones
-- nuevas de `public` a `anon` y `authenticated`; las migraciones anteriores sólo revocan de `public`.
-- Idempotente: se puede volver a ejecutar (scripts/reaplicar-permisos.sql la incluye completa).

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    -- anon (visitante sin sesión) no debe poder tocar nada.
    revoke all on all tables in schema public from anon;
    revoke all on all sequences in schema public from anon;
    revoke execute on all functions in schema public from anon;
    revoke usage on schema app from anon;
    revoke execute on all functions in schema app from anon;
  end if;

  -- authenticated: se quita todo y se vuelve a otorgar sólo lo necesario (abajo). Incluye TRUNCATE
  -- (no pasa por RLS ni bitácora) y escritura sobre pagos, liquidaciones, bitácora y vistas.
  revoke all on all tables in schema public from authenticated;
  revoke all on all sequences in schema public from authenticated;
  revoke truncate on all tables in schema public from app_server;

  -- Objetos futuros: sin privilegios automáticos. Las migraciones las ejecuta el rol `postgres` en
  -- Supabase; si las ejecutara otro rol, repetir estas sentencias con `for role <ese rol>`.
  if exists (select 1 from pg_roles where rolname = 'postgres') then
    alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
    alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
    alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
  end if;
end
$$;

-- Privilegios exactos de la aplicación (los mismos que otorgan 0001–0007).
grant usage on schema public to app_server, authenticated;
grant usage on schema app to app_server, authenticated;

grant select, insert, update, delete on
  usuarios, propietarios, propietario_usuarios, inmuebles, unidades, inquilinos, contratos,
  cargos, gastos, documentos
to app_server, authenticated;

-- El dinero y la bitácora sólo se leen; se escriben únicamente vía funciones security definer.
grant select on
  pagos, pago_aplicaciones, liquidaciones, liquidacion_lineas, ajustes_pendientes, bitacora
to app_server, authenticated;
grant select, insert on avisos_enviados to app_server, authenticated;

grant select on
  v_cargos, v_contratos,
  portal_propietario, portal_resumen_unidades, portal_contratos,
  portal_liquidaciones, portal_liquidacion_lineas, portal_documentos
to app_server, authenticated;

grant execute on function app.uid(), app.rol_actual(), app.mis_propietarios(), app.sesion_actual()
  to app_server, authenticated;
grant execute on function
  app.estatus_cargo(numeric, numeric, date),
  app.dias_atraso(numeric, numeric, date),
  app.estatus_contrato(estatus_contrato, date)
to app_server, authenticated;
grant execute on function
  generar_cargos_renta(date),
  registrar_pago(uuid[], numeric, date, text, text, cuenta_destino, text),
  cancelar_pago(uuid, text),
  actualizar_monto_cargo(uuid, numeric),
  preparar_liquidacion(uuid, date),
  cerrar_liquidacion(uuid),
  pagar_liquidacion(uuid, date, text, text),
  registrar_pdf_liquidacion(uuid, text),
  registrar_ajuste(uuid, numeric, text),
  registrar_comprobante_pago(uuid, text)
to app_server, authenticated;
