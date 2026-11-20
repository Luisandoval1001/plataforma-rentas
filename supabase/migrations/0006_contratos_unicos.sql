-- 0006_contratos_unicos: respaldo en BD de la regla "a lo más un contrato vigente por unidad".
-- Las acciones verifican antes (con la unidad bloqueada) para dar un mensaje claro; este índice
-- impide que cualquier otra vía (SQL directo, carga inicial, condiciones de carrera) la rompa.
create unique index contratos_una_vigente_por_unidad on contratos (unidad_id) where estatus = 'vigente';
