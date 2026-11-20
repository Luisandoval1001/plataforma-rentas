-- Reasigna los usuarios de la plataforma a los UUID de Supabase Auth después de restaurar un respaldo
-- en un proyecto nuevo (docs/despliegue.md §11.5). En el proyecto nuevo cada persona re-invitada recibe
-- otro UUID; usuarios.id debe ser igual a ese UUID para que pueda entrar.
--
-- 1. Re-invita a cada usuario en Supabase → Authentication → Users y copia su UID nuevo.
-- 2. Escribe abajo un renglón por usuario: ('<correo>', '<uid nuevo>').
-- 3. Ejecuta TODO el archivo como `postgres` (SQL Editor o psql -v ON_ERROR_STOP=1 -f).
--
-- session_replication_role = replica apaga, sólo en esta transacción, los triggers (bitácora,
-- inmutabilidad de liquidaciones cerradas) y la revisión de llaves foráneas mientras se cambian los
-- ids en todas las tablas que apuntan a usuarios. La bitácora conserva los ids anteriores (histórico).

begin;
set local session_replication_role = replica;

create temp table remapeo (email text primary key, nuevo uuid not null) on commit drop;
insert into remapeo (email, nuevo) values
  ('correo@ejemplo.com', '00000000-0000-0000-0000-000000000000');  -- REEMPLAZAR: un renglón por usuario

create temp table mapa on commit drop as
  select u.id as viejo, r.nuevo
  from usuarios u join remapeo r on lower(r.email) = lower(u.email)
  where u.id <> r.nuevo;

do $$
declare
  faltan text;
begin
  select string_agg(r.email, ', ') into faltan
  from remapeo r where not exists (select 1 from usuarios u where lower(u.email) = lower(r.email));
  if faltan is not null then
    raise exception 'Correos que no existen en usuarios: %', faltan;
  end if;
end
$$;

update usuarios t set id = m.nuevo from mapa m where t.id = m.viejo;
update propietario_usuarios t set usuario_id = m.nuevo from mapa m where t.usuario_id = m.viejo;
update inmuebles t set cobrador_id = m.nuevo from mapa m where t.cobrador_id = m.viejo;
update cargos t set creado_por = m.nuevo from mapa m where t.creado_por = m.viejo;
update pagos t set registrado_por = m.nuevo from mapa m where t.registrado_por = m.viejo;
update pagos t set cancelado_por = m.nuevo from mapa m where t.cancelado_por = m.viejo;
update gastos t set registrado_por = m.nuevo from mapa m where t.registrado_por = m.viejo;
update liquidaciones t set cerrada_por = m.nuevo from mapa m where t.cerrada_por = m.viejo;
update documentos t set subido_por = m.nuevo from mapa m where t.subido_por = m.viejo;
update ajustes_pendientes t set creado_por = m.nuevo from mapa m where t.creado_por = m.viejo;

select r.email, m.viejo, m.nuevo from mapa m join usuarios u on u.id = m.nuevo join remapeo r on lower(r.email) = lower(u.email);
commit;
