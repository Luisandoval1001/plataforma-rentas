-- Datos ficticios para la instalación de demostración. Fechas relativas a hoy: el mes anterior
-- queda cobrado y con su liquidación en borrador (lista para cerrar); el mes en curso, a medias.
-- Lo incluye scripts/generar-instalacion.sh --demo dentro de la transacción de instalación.

insert into app.configuracion (clave, valor) values ('dev_login', 'on');

insert into usuarios (id, email, nombre, rol) values
  ('d0000000-0000-4000-8000-000000000001', 'admin@demo.local', 'Luis · administrador', 'admin'),
  ('d0000000-0000-4000-8000-000000000002', 'cobranza@demo.local', 'Michelle · cobranza', 'equipo'),
  ('d0000000-0000-4000-8000-000000000003', 'edificio@demo.local', 'Alejandro Torres · dueño del edificio', 'propietario'),
  ('d0000000-0000-4000-8000-000000000004', 'owner@demo.local', 'Emma Collins · owner (portal in English)', 'propietario');

insert into propietarios (id, nombre, rfc, modelo, comision_pct, idioma) values
  ('d1000000-0000-4000-8000-000000000001', 'Copropietarios Edificio Río Elba 24', 'XAXX010101000', 'cobra_disa', 15, 'es'),
  ('d1000000-0000-4000-8000-000000000002', 'Harbor Lane Company', 'XEXX010101000', 'cobra_disa', 15, 'en'),
  ('d1000000-0000-4000-8000-000000000003', 'Familia Arriaga', null, 'cobra_propietario', 12, 'es');

insert into propietario_usuarios (propietario_id, usuario_id) values
  ('d1000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003'),
  ('d1000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000004');

insert into inmuebles (id, propietario_id, nombre, direccion, tipo, cobrador_id) values
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 'Edificio Río Elba 24', 'Río Elba 24, Col. Cuauhtémoc, CDMX', 'edificio', 'd0000000-0000-4000-8000-000000000002'),
  ('d2000000-0000-4000-8000-000000000002', 'd1000000-0000-4000-8000-000000000002', 'Doctor Vértiz 310', 'Dr. Vértiz 310, Col. Doctores, CDMX', 'departamento', 'd0000000-0000-4000-8000-000000000002'),
  ('d2000000-0000-4000-8000-000000000003', 'd1000000-0000-4000-8000-000000000003', 'Tonalá 88', 'Tonalá 88, Roma Norte, CDMX', 'departamento', 'd0000000-0000-4000-8000-000000000002');

insert into unidades (id, inmueble_id, nombre) values
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Depto 101'),
  ('d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'Depto 102'),
  ('d3000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000001', 'Depto 201'),
  ('d3000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-000000000001', 'Depto 202'),
  ('d3000000-0000-4000-8000-000000000005', 'd2000000-0000-4000-8000-000000000001', 'Depto 301'),
  ('d3000000-0000-4000-8000-000000000006', 'd2000000-0000-4000-8000-000000000001', 'Depto 302'),
  ('d3000000-0000-4000-8000-000000000007', 'd2000000-0000-4000-8000-000000000002', 'Depto 12'),
  ('d3000000-0000-4000-8000-000000000008', 'd2000000-0000-4000-8000-000000000003', 'Int. 4');

insert into inquilinos (id, nombre, email, telefono) values
  ('d4000000-0000-4000-8000-000000000001', 'Daniela Ruiz', 'daniela@demo.local', '5550000001'),
  ('d4000000-0000-4000-8000-000000000002', 'Jorge Medina', 'jorge@demo.local', '5550000002'),
  ('d4000000-0000-4000-8000-000000000003', 'Sofía Herrera', 'sofia@demo.local', '5550000003'),
  ('d4000000-0000-4000-8000-000000000004', 'Carlos Peña', 'carlos@demo.local', '5550000004'),
  ('d4000000-0000-4000-8000-000000000005', 'Ana Lucía Torres', 'ana@demo.local', '5550000005'),
  ('d4000000-0000-4000-8000-000000000006', 'Rodrigo Salas', 'rodrigo@demo.local', '5550000006'),
  ('d4000000-0000-4000-8000-000000000007', 'James Whitfield', 'james@demo.local', '5550000007'),
  ('d4000000-0000-4000-8000-000000000008', 'Valentina Ortiz', 'valentina@demo.local', '5550000008');

-- Contratos de un año que empezaron hace `antiguedad` meses (día 1). El último vence este mes.
insert into contratos (id, unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago, deposito)
select c.id, c.unidad_id, c.inquilino_id,
       (m.m0 - make_interval(months => c.antiguedad))::date,
       (m.m0 - make_interval(months => c.antiguedad) + interval '1 year' - interval '1 day')::date,
       c.renta, c.dia_pago, c.renta
from (select date_trunc('month', current_date)::date as m0) m,
     (values
       ('d5000000-0000-4000-8000-000000000001'::uuid, 'd3000000-0000-4000-8000-000000000001'::uuid, 'd4000000-0000-4000-8000-000000000001'::uuid, 9, 14500::numeric, 5),
       ('d5000000-0000-4000-8000-000000000002', 'd3000000-0000-4000-8000-000000000002', 'd4000000-0000-4000-8000-000000000002', 8, 14500, 5),
       ('d5000000-0000-4000-8000-000000000003', 'd3000000-0000-4000-8000-000000000003', 'd4000000-0000-4000-8000-000000000003', 5, 16000, 28),
       ('d5000000-0000-4000-8000-000000000004', 'd3000000-0000-4000-8000-000000000004', 'd4000000-0000-4000-8000-000000000004', 7, 16000, 1),
       ('d5000000-0000-4000-8000-000000000005', 'd3000000-0000-4000-8000-000000000005', 'd4000000-0000-4000-8000-000000000005', 4, 18000, 28),
       ('d5000000-0000-4000-8000-000000000006', 'd3000000-0000-4000-8000-000000000006', 'd4000000-0000-4000-8000-000000000006', 6, 18000, 5),
       ('d5000000-0000-4000-8000-000000000007', 'd3000000-0000-4000-8000-000000000007', 'd4000000-0000-4000-8000-000000000007', 2, 22000, 5),
       ('d5000000-0000-4000-8000-000000000008', 'd3000000-0000-4000-8000-000000000008', 'd4000000-0000-4000-8000-000000000008', 11, 18000, 5)
     ) as c(id, unidad_id, inquilino_id, antiguedad, renta, dia_pago);

-- Lo que sigue pasa por las funciones de dinero, como lo haría el administrador.
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

select generar_cargos_renta((date_trunc('month', current_date) - interval '1 month')::date),
       generar_cargos_renta(date_trunc('month', current_date)::date);

-- Mes anterior: todo cobrado (la Familia Arriaga cobra en su propia cuenta).
select registrar_pago(array[c.id], c.monto, (c.periodo + d.dia)::date, 'transferencia', 'SPEI-A' || d.n,
         case when c.propietario_id = 'd1000000-0000-4000-8000-000000000003' then 'propietario' else 'disa' end::cuenta_destino, null)
from cargos c
join (values (1, 2), (2, 3), (3, 8), (4, 0), (5, 4), (6, 5), (7, 3), (8, 4)) as d(n, dia)
  on c.contrato_id = ('d5000000-0000-4000-8000-00000000000' || d.n)::uuid
where c.periodo = (date_trunc('month', current_date) - interval '1 month')::date;

-- Mes en curso: 101, 102, 302 y Depto 12 pagados; 301 pago parcial; 201, 202 e Int. 4 sin pagar.
select registrar_pago(array[c.id], d.monto, least(c.periodo + d.dia, current_date), 'transferencia', 'SPEI-B' || d.n, 'disa', null)
from cargos c
join (values (1, 14500::numeric, 1), (2, 14500, 2), (5, 8000, 2), (6, 18000, 0), (7, 22000, 1)) as d(n, monto, dia)
  on c.contrato_id = ('d5000000-0000-4000-8000-00000000000' || d.n)::uuid
where c.periodo = date_trunc('month', current_date)::date;

insert into gastos (inmueble_id, unidad_id, fecha, concepto, monto, pagado_por, autorizado_por)
select g.inmueble_id, g.unidad_id, (m.m1 + g.dia)::date, g.concepto, g.monto, 'disa', g.autorizo
from (select (date_trunc('month', current_date) - interval '1 month')::date as m1) m,
     (values
       ('d2000000-0000-4000-8000-000000000001'::uuid, 'd3000000-0000-4000-8000-000000000003'::uuid, 14, 'Reparación de fuga en baño', 2300::numeric, 'Alejandro Torres'),
       ('d2000000-0000-4000-8000-000000000001', null, 19, 'Mantenimiento de bomba de agua', 1850, 'Alejandro Torres'),
       ('d2000000-0000-4000-8000-000000000002', 'd3000000-0000-4000-8000-000000000007', 11, 'Cerrajero: cambio de chapa', 900, 'Emma Collins')
     ) as g(inmueble_id, unidad_id, dia, concepto, monto, autorizo);

-- Liquidaciones del mes anterior en borrador: el administrador las revisa y las cierra.
select preparar_liquidacion(id, (date_trunc('month', current_date) - interval '1 month')::date) from propietarios;
