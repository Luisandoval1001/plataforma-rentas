# Plataforma de administración de rentas — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir la V1: aplicación interna del equipo (`app.`) y portal de propietarios (`clientes.`) sobre una base Postgres con reglas de dinero y acceso aplicadas en la base de datos.

**Architecture:** Toda la lógica de dinero (cargos, pagos, liquidaciones) y de acceso (RLS por rol) vive en migraciones SQL compatibles con Supabase y se prueba contra Postgres 16 local. La app Next.js (App Router) accede a Postgres desde el servidor como rol `app_server` fijando `request.jwt.claims` por transacción, de modo que las mismas políticas RLS aplican en local y en Supabase. Auth, archivos y correo son puertos con dos proveedores: `local` (desarrollo y pruebas) y `supabase`/`resend` (producción en Vercel).

**Tech Stack:** Next.js 16 (TypeScript, App Router, Tailwind), postgres.js, zod, @react-pdf/renderer, @supabase/ssr + @supabase/supabase-js (auth y storage en producción), resend, vitest (pruebas de BD y unitarias), Playwright (E2E), Postgres 16.

**Spec:** `docs/superpowers/specs/2026-11-03-plataforma-rentas-design.md`

## Global Constraints

- Idioma de la interfaz: español; portal con opción inglés por propietario (`propietarios.idioma` ∈ `es`,`en`).
- Montos `numeric(12,2)`; porcentajes `numeric(5,2)` en puntos (15.00 = 15%); IVA fijo 16% sobre la comisión.
- Cargos de renta se generan el día 1 de cada mes por contrato vigente; `dia_pago` entre 1 y 28.
- El estatus de cargos y contratos nunca se captura: se calcula en vistas.
- Los pagos no se borran: se cancelan con motivo. Nadie edita ni borra la bitácora.
- Sólo `admin` cierra liquidaciones y edita `% comisión` y datos de propietario. Una liquidación cerrada es inmutable; ajustes posteriores van al mes siguiente.
- El propietario sólo lee, sólo su cuenta, sólo liquidaciones `cerrada`/`pagada`, nunca notas internas ni contacto de inquilinos.
- Roles de usuario: `admin`, `equipo`, `propietario`. Rol de conexión a BD: `app_server` (no superusuario; RLS aplica).
- Las migraciones viven en `supabase/migrations/` y no crean el esquema `auth` (existe en Supabase); `auth.uid()` se simula localmente en `supabase/local/auth_shim.sql`.
- Commits frecuentes; cada tarea termina con pruebas en verde y commit.

## Review Focus

1. Pago mayor al saldo de los cargos seleccionados → se rechaza con error claro (no se crea crédito oculto). Prueba en Tarea 3.
2. Contrato que inicia a mitad de mes → V1 no prorratea: el cargo del primer mes es la renta completa y el equipo puede editar el monto de un cargo mientras no tenga pagos aplicados. Prueba en Tarea 3.
3. Doble captura del mismo pago (mismo propietario, misma referencia no vacía) → se rechaza. Prueba en Tarea 3.
4. `cerrar_liquidacion` dos veces, o `preparar_liquidacion` sobre una cerrada → error; preparar dos veces un borrador es idempotente. Prueba en Tarea 4.
5. Periodo sin cobros ni gastos → la liquidación se prepara y se cierra con ceros y genera PDF (no debe fallar por división o conjunto vacío). Prueba en Tareas 4 y 9.

---

## Estructura de archivos

```
plataforma-rentas/
  package.json, tsconfig.json, next.config.ts, tailwind.config.ts, vercel.json
  .env.example
  supabase/
    local/00_roles.sql            # rol app_server (local)
    local/auth_shim.sql           # auth.uid() y auth.jwt() para Postgres local
    migrations/0001_core.sql      # enums, usuarios, propietarios, inmuebles, unidades, inquilinos, contratos, funciones app.*, RLS
    migrations/0002_cobranza.sql  # cargos, pagos, pago_aplicaciones, v_cargos, v_contratos, generar_cargos_renta, registrar_pago, cancelar_pago
    migrations/0003_dinero.sql    # gastos, liquidaciones, liquidacion_lineas, ajustes_pendientes, preparar/cerrar/pagar_liquidacion
    migrations/0004_bitacora_docs.sql # bitacora + triggers, documentos, avisos_enviados, vistas portal_*
  scripts/
    db-local.sh                   # start | reset | test-db
    migrate.ts                    # aplica supabase/migrations en orden a DATABASE_URL
    carga-inicial.ts              # carga CSV del piloto
    backup.sh                     # pg_dump + copia de archivos
  src/
    middleware.ts                 # host app./clientes. → /app, /clientes
    lib/db.ts                     # sql, withSession(session, fn)
    lib/auth/session.ts           # Session, getSession(), requireRol()
    lib/auth/providers/local.ts   # cookie firmada (dev/pruebas)
    lib/auth/providers/supabase.ts
    lib/storage/index.ts          # putFile, getFileUrl; providers local.ts, supabase.ts
    lib/email/index.ts            # sendEmail; providers local.ts, resend.ts
    lib/i18n/{index.ts,es.ts,en.ts}
    lib/pdf/estado-cuenta.tsx     # renderEstadoCuentaPdf
    lib/validators/*.ts           # zod por entidad
    app/(auth)/login/page.tsx, app/(auth)/dev-login/page.tsx
    app/app/{layout.tsx,page.tsx}                 # tablero
    app/app/propietarios/..., inmuebles/..., contratos/..., cobranza/..., gastos/..., liquidaciones/...
    app/app/_actions/*.ts                         # server actions por entidad
    app/clientes/{layout.tsx,page.tsx,estados-de-cuenta/,contratos/,documentos/}
    app/api/archivos/[...path]/route.ts
    app/api/cron/diario/route.ts
  tests/
    db/harness.ts                 # resetDb, asUser, usuarios semilla
    db/*.test.ts                  # una suite por migración
    unit/*.test.ts
    e2e/*.spec.ts                 # Playwright
    e2e/seed.ts
```

---

### Tarea 1: Proyecto, Postgres local y arnés de pruebas de BD

**Files:**
- Create: `package.json` (vía create-next-app), `scripts/db-local.sh`, `scripts/migrate.ts`, `supabase/local/00_roles.sql`, `supabase/local/auth_shim.sql`, `tests/db/harness.ts`, `tests/db/harness.test.ts`, `vitest.config.ts`, `.env.example`
- Test: `tests/db/harness.test.ts`

**Interfaces:**
- Produces: `resetDb(): Promise<void>` (recrea `rentas_test`, aplica `supabase/local/*.sql` y `supabase/migrations/*.sql` en orden), `sqlAdmin` (conexión superusuario para semillas), `asUser(usuarioId: string, fn: (sql) => Promise<T>): Promise<T>` (transacción con `SET LOCAL ROLE app_server` y `set_config('request.jwt.claims', '{"sub":"<id>","role":"authenticated"}', true)`), `seedUsuarios(): Promise<{admin, equipo, propA, propB}>` con ids fijos.
- Variables: `DATABASE_URL` (app, rol `app_server`), `DATABASE_ADMIN_URL` (migraciones/pruebas), `AUTH_PROVIDER=local|supabase`, `STORAGE_PROVIDER=local|supabase`, `EMAIL_PROVIDER=local|resend`, `SESSION_SECRET`, `CRON_SECRET`.

- [ ] **Paso 1: Crear el proyecto** — `npx create-next-app@latest . --ts --tailwind --app --src-dir --eslint --no-import-alias` dentro de `plataforma-rentas/`; instalar `postgres zod vitest @vitest/coverage-v8 tsx`.
- [ ] **Paso 2: `scripts/db-local.sh`** — `start`: `pg_ctlcluster 16 main start` (si está abajo) y crea rol `app_server LOGIN PASSWORD 'app_server'` si no existe; `reset <db>`: drop/create base y aplica `supabase/local/*.sql` + migraciones con `scripts/migrate.ts`.
- [ ] **Paso 3: `supabase/local/auth_shim.sql`** — `create schema if not exists auth; create or replace function auth.uid() returns uuid` que lee `request.jwt.claims`→`sub` (misma implementación que Supabase); `auth.jwt() returns jsonb`.
- [ ] **Paso 4: Escribir `tests/db/harness.test.ts`** — `test('asUser fija auth.uid()')`: `await resetDb(); const u = await seedUsuarios(); const r = await asUser(u.admin, s => s\`select auth.uid() as id\`); expect(r[0].id).toBe(u.admin)`.
- [ ] **Paso 5: Correr y ver que falla** — `npx vitest run tests/db/harness.test.ts` → FAIL (harness no existe).
- [ ] **Paso 6: Implementar `tests/db/harness.ts` y `scripts/migrate.ts`** — `migrate.ts` lee `supabase/migrations/*.sql` ordenados por nombre y los ejecuta en una transacción cada uno; `seedUsuarios` inserta en `usuarios` (la tabla llega en Tarea 2: para esta tarea el test sólo requiere `auth.uid()`, así que `seedUsuarios` devuelve ids fijos y la inserción se activa cuando exista la tabla — usar `to_regclass('public.usuarios')`).
- [ ] **Paso 7: Correr y ver que pasa** — `bash scripts/db-local.sh start && npx vitest run tests/db/harness.test.ts` → PASS.
- [ ] **Paso 8: Commit** — `git add -A && git commit -m "chore: proyecto Next.js, Postgres local y arnés de pruebas de BD"`.

---

### Tarea 2: Migración 0001 — esquema base y RLS

**Files:**
- Create: `supabase/migrations/0001_core.sql`
- Test: `tests/db/core.test.ts`

**Interfaces:**
- Produces (tablas): `usuarios(id uuid pk, email text unique, nombre text, rol rol_usuario, activo bool)`, `propietarios(id, nombre, rfc, modelo modelo_dinero, comision_pct numeric(5,2), cuenta_ultimos4 text, recargo_visible bool default false, recargos_al_propietario bool default false, idioma text default 'es' check (idioma in ('es','en')), avisos_pago bool default true, avisos_estado_cuenta bool default true, avisos_contrato bool default true, contacto_email text, contacto_tel text, activo bool default true)`, `propietario_usuarios(propietario_id, usuario_id) pk`, `inmuebles(id, propietario_id, nombre, direccion, tipo tipo_inmueble, cobrador_id uuid null → usuarios)`, `unidades(id, inmueble_id, propietario_id, nombre)`, `inquilinos(id, nombre, email, telefono, rfc)`, `contratos(id, unidad_id, propietario_id, inquilino_id, fecha_inicio date, fecha_fin date, renta_mensual numeric(12,2), dia_pago smallint check (1..28), deposito numeric(12,2) default 0, incremento_anual_pct numeric(5,2) default 0, estatus estatus_contrato default 'vigente', pendiente_firma_desde date, contrato_origen_id uuid, pdf_path text)`.
- Enums: `rol_usuario (admin, equipo, propietario)`, `modelo_dinero (cobra_disa, cobra_propietario)`, `tipo_inmueble (departamento, casa, edificio, local, terreno, nave, otro)`, `estatus_contrato (pendiente_firma, vigente, terminado)`.
- Funciones: `app.rol_actual() returns rol_usuario` (stable, security definer), `app.mis_propietarios() returns setof uuid`.
- RLS: `admin` todo en todas; `equipo` select todo, insert/update en inmuebles, unidades, inquilinos, contratos; sin insert/update/delete en propietarios ni propietario_usuarios; `propietario` select en `propietarios`, `inmuebles`, `unidades`, `contratos` filtrado por `propietario_id in (select app.mis_propietarios())`; sin acceso a `inquilinos` ni `usuarios` (salvo su propio renglón).
- Todas las políticas `TO app_server, authenticated` (el rol `authenticated` existe en Supabase; crearlo `NOLOGIN` en `00_roles.sql` local).

- [ ] **Paso 1: Escribir `tests/db/core.test.ts`** — con `resetDb()` y `seedUsuarios()` (ahora sí inserta: admin, equipo, propA, propB; propA ligado a propietario "A", propB a "B"):
  - `test('propietario A no ve inmuebles de B')`: admin inserta un inmueble por propietario; `asUser(propA, …select * from inmuebles)` → `length 1` y `propietario_id` = A.
  - `test('equipo ve todos los propietarios pero no puede cambiar comision_pct')`: select → 2; `update propietarios set comision_pct = 10` como equipo → lanza error de RLS.
  - `test('equipo crea inmueble, unidad, inquilino y contrato')`: inserts como equipo → ok; `dia_pago = 31` → viola check.
  - `test('propietario no lee inquilinos')`: select como propA → `[]`.
  - `test('app.rol_actual()')`: admin→`admin`, propA→`propietario`.
- [ ] **Paso 2: Correr y ver que falla** — `npx vitest run tests/db/core.test.ts` → FAIL (tablas no existen).
- [ ] **Paso 3: Escribir `0001_core.sql`** — enums, tablas, índices por `propietario_id`, funciones `app.*`, `alter table … enable row level security` y políticas por rol según Interfaces. `unidades.propietario_id` se rellena por trigger `before insert` desde `inmuebles`; `contratos.propietario_id` desde `unidades`.
- [ ] **Paso 4: Correr y ver que pasa** — `npx vitest run tests/db/core.test.ts` → PASS.
- [ ] **Paso 5: Commit** — `git commit -am "feat(db): esquema base, roles y RLS"`.

---

### Tarea 3: Migración 0002 — cargos, pagos y estatus calculados

**Files:**
- Create: `supabase/migrations/0002_cobranza.sql`
- Test: `tests/db/cobranza.test.ts`

**Interfaces:**
- Consumes: tablas y funciones de Tarea 2.
- Produces (tablas): `cargos(id, contrato_id, propietario_id, tipo tipo_cargo, periodo date, monto numeric(12,2), fecha_limite date, notas text, creado_por uuid)` con `unique (contrato_id, periodo) where tipo = 'renta'`; `pagos(id, propietario_id, fecha date, monto numeric(12,2), metodo text, referencia text, cuenta_destino cuenta_destino, comprobante_path text, registrado_por uuid, cancelado bool default false, cancelado_motivo text, cancelado_at timestamptz, cancelado_por uuid)` con `unique (propietario_id, referencia) where referencia <> '' and not cancelado`; `pago_aplicaciones(id, pago_id, cargo_id, monto)`.
- Enums: `tipo_cargo (renta, recargo, otro)`, `cuenta_destino (disa, propietario)`.
- Vistas (`security_invoker = true`): `v_cargos` = cargos + `pagado` (suma de aplicaciones de pagos no cancelados), `saldo = monto - pagado`, `estatus text` ∈ `pagado` (saldo ≤ 0) | `vencido` (saldo > 0 y `current_date > fecha_limite`) | `parcial` (pagado > 0 y saldo > 0) | `pendiente`, `dias_atraso int` (0 si no vencido); `v_contratos` = contratos + `estatus_calc text` ∈ `pendiente_firma` | `terminado` | `vencido` (`fecha_fin < current_date`) | `por_vencer` (`fecha_fin - current_date <= 60`) | `vigente`, + `inquilino_nombre`.
- Funciones (security definer, validan `app.rol_actual() in ('admin','equipo')`):
  - `generar_cargos_renta(p_periodo date) returns int` — por cada contrato `estatus='vigente'` con `fecha_inicio <= último día de p_periodo` y `fecha_fin >= p_periodo`, inserta cargo `renta` con `monto = renta_mensual`, `fecha_limite = p_periodo + (dia_pago - 1)`; `on conflict do nothing`; devuelve insertados.
  - `registrar_pago(p_cargo_ids uuid[], p_monto numeric, p_fecha date, p_metodo text, p_referencia text, p_cuenta cuenta_destino, p_comprobante_path text) returns uuid` — aplica `p_monto` a los cargos en el orden dado hasta agotar cada saldo; si sobra monto → `raise exception 'MONTO_EXCEDE_SALDO'`; todos los cargos deben ser del mismo propietario.
  - `cancelar_pago(p_pago_id uuid, p_motivo text) returns void` — marca cancelado (no borra); `p_motivo` obligatorio no vacío.
  - `actualizar_monto_cargo(p_cargo_id uuid, p_monto numeric) returns void` — sólo si el cargo no tiene aplicaciones; si tiene → `raise exception 'CARGO_CON_PAGOS'`.
- RLS: equipo/admin select en todo; equipo insert cargos `recargo`/`otro` y update de `notas`; sin update/delete directo en `pagos` (sólo vía funciones); propietario sin políticas directas (vistas portal en Tarea 5).

- [ ] **Paso 1: Escribir `tests/db/cobranza.test.ts`** — fixture: propietario A (cobra_disa, 15%), inmueble, unidad, inquilino, contrato vigente 2026-01-01→2026-12-31, renta 10,000, dia_pago 5.
  - `generar_cargos_renta('2026-03-01')` → 1; segunda llamada → 0; cargo `monto 10000`, `fecha_limite 2026-03-05`.
  - `pago parcial`: `registrar_pago([c], 4000, '2026-03-02', …)` → `v_cargos.estatus = 'parcial'`, `saldo = 6000` (fijar `current_date` con fechas del fixture en 2026-03; usar fecha_limite futura relativa a `current_date` para no depender del reloj: construir el contrato con `dia_pago` tal que `fecha_limite = current_date + 3`).
  - `pago adelantado de dos meses`: generar marzo y abril; `registrar_pago([c_mar, c_abr], 20000)` → ambos `pagado`.
  - `vencido`: cargo con `fecha_limite = current_date - 10` sin pago → `estatus 'vencido'`, `dias_atraso 10`.
  - `sobrepago`: `registrar_pago([c], 12000)` → error `MONTO_EXCEDE_SALDO`.
  - `doble captura`: dos `registrar_pago` con `referencia 'REF-1'` mismo propietario → segundo falla por unique.
  - `cancelar_pago` → `cancelado = true`, el cargo vuelve a `pendiente`; `delete from pagos` como equipo → error RLS.
  - `contrato a mitad de mes`: `fecha_inicio = p_periodo + 14` → se genera cargo con renta completa; `actualizar_monto_cargo` a 5000 funciona; tras un pago → `CARGO_CON_PAGOS`.
  - `v_contratos`: `fecha_fin = current_date + 30` → `por_vencer`; `pendiente_firma_desde` no nulo y estatus `pendiente_firma` → `pendiente_firma`.
- [ ] **Paso 2: Correr y ver que falla** — `npx vitest run tests/db/cobranza.test.ts` → FAIL.
- [ ] **Paso 3: Escribir `0002_cobranza.sql`** según Interfaces.
- [ ] **Paso 4: Correr y ver que pasa** — PASS.
- [ ] **Paso 5: Commit** — `git commit -am "feat(db): cargos, pagos y estatus calculados"`.

---

### Tarea 4: Migración 0003 — gastos y liquidaciones

**Files:**
- Create: `supabase/migrations/0003_dinero.sql`
- Test: `tests/db/dinero.test.ts`

**Interfaces:**
- Produces (tablas): `gastos(id, propietario_id, inmueble_id, unidad_id null, fecha date, concepto text, monto numeric(12,2), comprobante_path text, pagado_por pagado_por, autorizado_por text, registrado_por uuid)`; `liquidaciones(id, propietario_id, periodo date, estatus estatus_liquidacion default 'borrador', modelo modelo_dinero, comision_pct numeric(5,2), cobrado, comision, iva, gastos_disa, gastos_propietario, ajustes, neto numeric(12,2), cerrada_at, cerrada_por, pagada_at, pago_fecha date, pago_referencia text, pago_comprobante_path text, pdf_path text, unique (propietario_id, periodo))`; `liquidacion_lineas(id, liquidacion_id, tipo text check (tipo in ('cobro','gasto_disa','gasto_propietario','ajuste')), referencia_id uuid, descripcion text, monto numeric(12,2))`; `ajustes_pendientes(id, propietario_id, monto numeric(12,2), descripcion text, origen_pago_id uuid, aplicado_en uuid null → liquidaciones)`.
- Enums: `pagado_por (disa, propietario)`, `estatus_liquidacion (borrador, cerrada, pagada)`.
- Funciones (security definer):
  - `preparar_liquidacion(p_propietario_id uuid, p_periodo date) returns uuid` — admin/equipo. Si existe en `cerrada`/`pagada` → `raise 'LIQUIDACION_CERRADA'`. Crea o reutiliza el borrador, borra sus líneas y las reconstruye: **cobros** = `pago_aplicaciones` de pagos no cancelados con `pagos.fecha` dentro del mes, sobre cargos `tipo='renta'` (y `recargo` si `propietarios.recargos_al_propietario`); **gastos** del mes por `pagado_por`; **ajustes** = `ajustes_pendientes` con `aplicado_en is null`. Totales: `cobrado = Σcobros`, `comision = round(cobrado*comision_pct/100, 2)`, `iva = round(comision*0.16, 2)`, `gastos_disa`, `gastos_propietario`, `ajustes = Σajustes`; `neto` = si `modelo='cobra_disa'`: `cobrado − comision − iva − gastos_disa + ajustes`; si `cobra_propietario`: `−(comision + iva + gastos_disa) + ajustes`. Snapshot de `modelo` y `comision_pct` en el renglón.
  - `cerrar_liquidacion(p_id uuid) returns void` — sólo admin (`raise 'SOLO_ADMIN'`); sólo desde `borrador` (`raise 'ESTATUS_INVALIDO'`); marca `cerrada`, `cerrada_at/por`, y `ajustes_pendientes.aplicado_en = p_id` para los incluidos.
  - `pagar_liquidacion(p_id uuid, p_fecha date, p_referencia text, p_comprobante_path text) returns void` — admin/equipo; sólo desde `cerrada`.
  - `cancelar_pago` (modificar en esta migración con `create or replace`): si alguna aplicación del pago pertenece a un cargo cuyo cobro está en una liquidación `cerrada`/`pagada`, inserta en `ajustes_pendientes` `monto = −(monto aplicado)`, `descripcion = 'Cancelación de pago <referencia> del periodo <periodo>'`.
- RLS: equipo insert/update gastos; admin delete gastos; liquidaciones/lineas: select admin/equipo; sin insert/update directo (sólo funciones); propietario: vistas portal (Tarea 5).

- [ ] **Paso 1: Escribir `tests/db/dinero.test.ts`** — fixtures: A `cobra_disa` 15%, B `cobra_propietario` 12%; contratos renta 10,000; cargos de marzo; pagos de 10,000 el 2026-03-03.
  - A, gasto DISA 1,000 y gasto propietario 500 en marzo: `preparar` → `cobrado 10000, comision 1500, iva 240, gastos_disa 1000, gastos_propietario 500, neto 7260`; 4 líneas.
  - B: `preparar` → `cobrado 10000, comision 1200, iva 192, neto −1392` (sin gastos).
  - Periodo vacío (A, abril sin pagos ni gastos) → `neto 0`, se puede cerrar.
  - `preparar` dos veces → mismo `id`, mismas líneas (sin duplicar).
  - `cerrar` como equipo → `SOLO_ADMIN`; como admin → `cerrada`; segundo `cerrar` → `ESTATUS_INVALIDO`; `preparar` sobre cerrada → `LIQUIDACION_CERRADA`.
  - Inmutabilidad: cerrar marzo de A; `cancelar_pago` del pago de marzo → `liquidaciones.neto` de marzo sigue `7260`; `ajustes_pendientes` tiene `−10000`; `preparar(A, abril)` → línea `ajuste −10000`, `neto −10000`; `cerrar(abril)` → `aplicado_en = id abril`.
  - `pagar_liquidacion` desde borrador → `ESTATUS_INVALIDO`; desde cerrada → `pagada` con `pago_fecha`.
  - `recargos_al_propietario = true` en A, cargo `recargo` 500 pagado → `cobrado 10500`; con `false` → `10000`.
- [ ] **Paso 2: Correr y ver que falla** — FAIL.
- [ ] **Paso 3: Escribir `0003_dinero.sql`** según Interfaces.
- [ ] **Paso 4: Correr y ver que pasa** — PASS; además `npx vitest run tests/db` completo → PASS.
- [ ] **Paso 5: Commit** — `git commit -am "feat(db): gastos y liquidaciones"`.

---

### Tarea 5: Migración 0004 — bitácora, documentos, avisos y vistas del portal

**Files:**
- Create: `supabase/migrations/0004_bitacora_docs.sql`
- Test: `tests/db/bitacora_portal.test.ts`

**Interfaces:**
- Produces: `bitacora(id bigserial, tabla text, registro_id uuid, accion text, usuario_id uuid, at timestamptz default now(), antes jsonb, despues jsonb)` — sin políticas de update/delete para nadie; insert sólo desde trigger `app.registrar_bitacora()` (security definer) en `pagos`, `gastos`, `contratos`, `liquidaciones`, `cargos` (insert/update/delete); `documentos(id, propietario_id, tipo tipo_documento, nombre text, path text, unidad_id, pago_id, liquidacion_id, subido_por uuid, visible_propietario bool default true)`; `avisos_enviados(id, propietario_id, tipo text, referencia_id uuid, enviado_at, unique (tipo, referencia_id))`.
- Enum: `tipo_documento (factura, reporte, contrato, comprobante, otro)`.
- Vistas del portal, dueño `postgres`, **sin** `security_invoker` (filtran por `app.mis_propietarios()` y exigen `app.rol_actual()='propietario'`; `grant select … to app_server, authenticated`): `portal_resumen_unidades` (unidad, inmueble, cargo del mes en curso: monto, fecha_limite, estatus, dias_atraso, pagado, ultimo_pago_fecha; tipo `recargo` sólo si `recargo_visible`), `portal_contratos` (unidad, inquilino_nombre, fecha_inicio, fecha_fin, renta_mensual, deposito, estatus_calc, pdf_path), `portal_liquidaciones` (sólo `cerrada`/`pagada`, totales y pdf_path), `portal_liquidacion_lineas`, `portal_documentos` (`visible_propietario`), `portal_propietario` (nombre, idioma, avisos_*). Ninguna expone `notas`, `registrado_por`, ni contacto de inquilino.

- [ ] **Paso 1: Escribir `tests/db/bitacora_portal.test.ts`**
  - `registrar_pago` como equipo → fila en `bitacora` con `tabla='pagos'`, `accion='INSERT'`, `usuario_id = equipo`; `cancelar_pago` → fila `UPDATE` con `antes.cancelado=false`, `despues.cancelado=true`.
  - `update bitacora …` y `delete from bitacora` como admin → error RLS.
  - `portal_resumen_unidades` como propA → sólo unidades de A; como propB → sólo B; como equipo → `[]` (la vista exige rol propietario).
  - `portal_liquidaciones` como propA con una liquidación en borrador y otra cerrada → 1 fila.
  - `portal_resumen_unidades` no tiene columna `notas` (consultar `information_schema.columns`).
  - `recargo_visible=false` → la vista omite cargos `recargo`; `true` → los incluye.
- [ ] **Paso 2: Correr y ver que falla** — FAIL.
- [ ] **Paso 3: Escribir `0004_bitacora_docs.sql`**.
- [ ] **Paso 4: Correr y ver que pasa** — `npx vitest run tests/db` → PASS.
- [ ] **Paso 5: Commit** — `git commit -am "feat(db): bitácora, documentos, avisos y vistas del portal"`.

---

### Tarea 6: Sesión, acceso a BD y puertos (auth, archivos, correo)

**Files:**
- Create: `src/lib/db.ts`, `src/lib/auth/session.ts`, `src/lib/auth/providers/local.ts`, `src/lib/auth/providers/supabase.ts`, `src/lib/storage/{index.ts,local.ts,supabase.ts}`, `src/lib/email/{index.ts,local.ts,resend.ts}`, `src/middleware.ts`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/dev-login/page.tsx`, `src/app/api/archivos/[...path]/route.ts`
- Test: `tests/unit/db-session.test.ts`, `tests/unit/storage-local.test.ts`, `tests/unit/email-local.test.ts`, `tests/unit/middleware.test.ts`

**Interfaces:**
- Produces: `type Session = { usuarioId: string; email: string; rol: 'admin'|'equipo'|'propietario'; propietarioIds: string[] }`; `getSession(): Promise<Session|null>`; `requireRol(...roles): Promise<Session>` (redirige a `/login` si no hay sesión; lanza `403` si rol no permitido); `withSession<T>(session: Session, fn: (sql: postgres.TransactionSql) => Promise<T>): Promise<T>` — transacción con `set local role app_server` y `select set_config('request.jwt.claims', $claims, true)` donde claims = `{"sub": usuarioId, "role": "authenticated"}`; `putFile(path: string, data: Buffer, contentType: string): Promise<void>`, `getFileUrl(path: string): Promise<string>` (local: `/api/archivos/<path>`; supabase: URL firmada 1 h); `sendEmail(msg: {to: string; subject: string; html: string}): Promise<void>` (local: escribe JSON en `tmp/emails/<timestamp>.json`; resend: SDK).
- Proveedor `local` de auth: cookie `sesion` firmada HMAC con `SESSION_SECRET` conteniendo `usuarioId`; `/dev-login` lista usuarios activos y fija la cookie — sólo si `AUTH_PROVIDER=local`. Proveedor `supabase`: `@supabase/ssr` lee la sesión; `usuarios.id` = `auth.users.id`.
- `middleware.ts`: si `host` empieza con `clientes.` → rewrite a `/clientes` + path; si `app.` → `/app` + path; en localhost no reescribe.
- `/api/archivos/[...path]`: exige sesión; si rol `propietario`, el path debe empezar con `propietarios/<id>/` de uno de sus `propietarioIds`.

- [ ] **Paso 1: Escribir pruebas** — `db-session.test.ts`: `withSession(sesionPropA, sql => sql\`select * from inmuebles\`)` → sólo A (usa harness de BD); `withSession(sesionEquipo, …insert en propietarios)` → error. `storage-local.test.ts`: `putFile('propietarios/x/a.txt', …)` escribe en `storage/propietarios/x/a.txt`; `getFileUrl` → `/api/archivos/propietarios/x/a.txt`. `email-local.test.ts`: `sendEmail` crea archivo JSON con `to`, `subject`. `middleware.test.ts`: host `clientes.ctdisa.com` path `/` → rewrite `/clientes`; `app.ctdisa.com/cobranza` → `/app/cobranza`; `localhost:3000/app` → sin rewrite.
- [ ] **Paso 2: Correr y ver que fallan** — `npx vitest run tests/unit` → FAIL.
- [ ] **Paso 3: Implementar** los módulos según Interfaces. `db.ts` crea el cliente `postgres(process.env.DATABASE_URL)` con `max: 5`.
- [ ] **Paso 4: Correr y ver que pasan** — PASS.
- [ ] **Paso 5: Commit** — `git commit -am "feat: sesión, acceso a BD con RLS y puertos de auth/archivos/correo"`.

---

### Tarea 7: App del equipo — propietarios, inmuebles, unidades, inquilinos y contratos

**Files:**
- Create: `src/lib/validators/{propietario,inmueble,unidad,inquilino,contrato}.ts`, `src/app/app/layout.tsx` (navegación: Tablero, Cobranza, Inmuebles, Contratos, Gastos, Liquidaciones, Propietarios), `src/app/app/propietarios/{page.tsx,nuevo/page.tsx,[id]/page.tsx}`, `src/app/app/inmuebles/{page.tsx,nuevo/page.tsx,[id]/page.tsx}` (ficha con unidades y alta de unidad), `src/app/app/contratos/{page.tsx,nuevo/page.tsx,[id]/page.tsx}`, `src/app/app/_actions/{propietarios,inmuebles,unidades,inquilinos,contratos}.ts`, `tests/e2e/seed.ts`, `playwright.config.ts`
- Test: `tests/unit/validators.test.ts`, `tests/e2e/altas.spec.ts`

**Interfaces:**
- Consumes: `requireRol`, `withSession`, `putFile`.
- Produces (server actions, todas reciben `FormData`, validan con zod y devuelven `{ok: true, id} | {ok: false, errores: Record<string,string>}`): `crearPropietario`, `actualizarPropietario` (sólo admin), `invitarUsuarioPropietario(propietarioId, email, nombre)` (admin; local: inserta `usuarios` + `propietario_usuarios`; supabase: `auth.admin.inviteUserByEmail` y luego inserta), `crearInmueble`, `actualizarInmueble`, `crearUnidad`, `crearInquilino`, `crearContrato` (con PDF opcional → `putFile('propietarios/<pid>/contratos/<id>.pdf')`), `renovarContrato(contratoId)` (crea contrato nuevo `estatus='pendiente_firma'`, `pendiente_firma_desde = hoy`, `fecha_inicio = fin+1`, `fecha_fin = +1 año`, `renta = round(renta*(1+incremento/100),2)`, `contrato_origen_id`), `activarContrato(contratoId, pdf)` (pendiente_firma → vigente y termina el de origen), `terminarContrato(contratoId)`.
- `tests/e2e/seed.ts`: `resetDb` + usuarios semilla (admin `admin@local`, equipo `equipo@local`, propA, propB) para Playwright con `AUTH_PROVIDER=local`.

- [ ] **Paso 1: Escribir `tests/unit/validators.test.ts`** — contrato: `dia_pago 0` → error; `fecha_fin < fecha_inicio` → error; propietario: `comision_pct 101` → error; `idioma 'fr'` → error.
- [ ] **Paso 2: Escribir `tests/e2e/altas.spec.ts`** — login dev como admin → crear propietario "Villalongin" (cobra_disa, 15) → crear inmueble "Orizaba 36" → unidad "407" → inquilino → contrato (renta 18,000, dia_pago 5) → la lista de contratos muestra `vigente`; login como equipo → `/app/propietarios/<id>` no muestra botón "Editar comisión"; `renovarContrato` desde la ficha → aparece "pendiente de firma desde <hoy>".
- [ ] **Paso 3: Correr y ver que fallan** — `npx vitest run tests/unit/validators.test.ts` FAIL; `npx playwright test altas` FAIL.
- [ ] **Paso 4: Implementar** validadores, acciones, páginas (formularios simples, tablas, español; componentes de formulario reutilizables en `src/components/ui/`). `playwright.config.ts` con `webServer: npm run dev` y `globalSetup: tests/e2e/seed.ts`.
- [ ] **Paso 5: Correr y ver que pasan** — PASS.
- [ ] **Paso 6: Commit** — `git commit -am "feat(app): altas de propietarios, inmuebles, unidades, inquilinos y contratos"`.

---

### Tarea 8: App del equipo — cobranza y tablero del día

**Files:**
- Create: `src/app/app/page.tsx` (tablero), `src/app/app/cobranza/page.tsx`, `src/app/app/cobranza/_components/RegistrarPagoDialog.tsx`, `src/app/app/_actions/cobranza.ts`, `src/lib/queries/{tablero,cobranza}.ts`
- Test: `tests/e2e/cobranza.spec.ts`

**Interfaces:**
- Consumes: `v_cargos`, `registrar_pago`, `cancelar_pago`, `actualizar_monto_cargo`, `generar_cargos_renta`, `sendEmail`.
- Produces: `registrarPago(FormData{cargoIds[], monto, fecha, metodo, referencia, cuenta, comprobante})` → llama `registrar_pago`, sube comprobante a `propietarios/<pid>/pagos/<id>.<ext>`, y si `propietarios.avisos_pago` envía correo "Se registró un pago en <inmueble> <unidad>" al contacto; `cancelarPago(pagoId, motivo)`; `actualizarNotaCargo(cargoId, notas)`; `actualizarMontoCargo(cargoId, monto)`; `generarCargosMes()` (admin, periodo actual). Consultas: `tablero(session)` → `{vencidos: [...], pagosHoy: [...], contratosPorVencer: [...], liquidacionesPendientes: [...]}`; `cargosDelMes(session, filtros{inmuebleId?, propietarioId?, estatus?, cobradorId?})`. Filtro por cobrador por defecto = usuario actual si tiene inmuebles asignados.
- Errores de BD mapeados a mensajes: `MONTO_EXCEDE_SALDO` → "El monto excede el saldo de los cargos seleccionados"; unique de referencia → "Ya existe un pago con esa referencia"; `CARGO_CON_PAGOS` → "El cargo ya tiene pagos; cancélalos primero".

- [ ] **Paso 1: Escribir `tests/e2e/cobranza.spec.ts`** — seed con contrato y cargos del mes (uno vencido): tablero muestra 1 vencido con días de atraso; cobranza → "Registrar pago" monto parcial → renglón `parcial`; pago con mismo `referencia` → mensaje "Ya existe un pago con esa referencia"; sobrepago → mensaje de saldo; cancelar pago con motivo → renglón vuelve a `pendiente`; `tmp/emails` contiene correo con asunto que incluye el nombre de la unidad.
- [ ] **Paso 2: Correr y ver que falla** — FAIL.
- [ ] **Paso 3: Implementar** consultas, acciones y páginas. Tablero: cuatro bloques con conteos y listas; sin gráficas.
- [ ] **Paso 4: Correr y ver que pasa** — PASS.
- [ ] **Paso 5: Commit** — `git commit -am "feat(app): cobranza, registro de pagos y tablero del día"`.

---

### Tarea 9: App del equipo — gastos, liquidaciones, PDF y documentos

**Files:**
- Create: `src/app/app/gastos/{page.tsx,nuevo/page.tsx}`, `src/app/app/liquidaciones/{page.tsx,[id]/page.tsx}`, `src/app/app/_actions/{gastos,liquidaciones,documentos}.ts`, `src/lib/pdf/estado-cuenta.tsx`, `src/lib/queries/liquidaciones.ts`, `src/app/app/propietarios/[id]/documentos/page.tsx`
- Test: `tests/unit/pdf-estado-cuenta.test.ts`, `tests/e2e/liquidaciones.spec.ts`

**Interfaces:**
- Consumes: `preparar_liquidacion`, `cerrar_liquidacion`, `pagar_liquidacion`, `putFile`, `sendEmail`.
- Produces: `crearGasto(FormData)`, `prepararLiquidacion(propietarioId, periodo)`, `cerrarLiquidacion(id)` (admin; tras cerrar: `renderEstadoCuentaPdf` → `putFile('propietarios/<pid>/liquidaciones/<periodo>.pdf')`, guarda `pdf_path`, inserta `documentos` tipo `reporte`, y si `avisos_estado_cuenta` envía "Tu estado de cuenta de <mes> está listo"), `pagarLiquidacion(id, fecha, referencia, comprobante)`, `subirDocumento(propietarioId, tipo, archivo, {pagoId?, liquidacionId?, unidadId?})` (factura: PDF y XML como dos documentos con el mismo `nombre`).
- `renderEstadoCuentaPdf(data: EstadoCuentaData, idioma: 'es'|'en'): Promise<Buffer>` donde `EstadoCuentaData = { propietario: {nombre, rfc}, periodo: string, modelo, comisionPct, lineas: {tipo, descripcion, monto}[], totales: {cobrado, comision, iva, gastosDisa, gastosPropietario, ajustes, neto} }`. Encabezado "Casas y Terrenos DISA — Estado de cuenta", tabla de líneas, bloque de totales, leyenda "Neto a favor del propietario" si `neto ≥ 0`, "Saldo a favor de DISA" si `< 0`.

- [ ] **Paso 1: Escribir `tests/unit/pdf-estado-cuenta.test.ts`** — con datos de la Tarea 4 (A, marzo) → `Buffer` que empieza con `%PDF`; el texto extraído (pdf-parse) contiene `7,260.00` y "Neto a favor del propietario"; con `neto −1392` contiene "Saldo a favor de DISA"; con `lineas: []` y totales en cero → renderiza sin error.
- [ ] **Paso 2: Escribir `tests/e2e/liquidaciones.spec.ts`** — equipo registra gasto DISA 1,000; equipo prepara liquidación de A → totales visibles, botón "Cerrar" deshabilitado para equipo; admin cierra → estatus `cerrada`, enlace al PDF responde 200 y `content-type: application/pdf`; `tmp/emails` tiene el aviso; registrar pago de liquidación → `pagada`.
- [ ] **Paso 3: Correr y ver que fallan** — FAIL.
- [ ] **Paso 4: Implementar** — instalar `@react-pdf/renderer pdf-parse`; acciones, consultas, páginas.
- [ ] **Paso 5: Correr y ver que pasan** — PASS.
- [ ] **Paso 6: Commit** — `git commit -am "feat(app): gastos, liquidaciones, PDF de estado de cuenta y documentos"`.

---

### Tarea 10: Tarea diaria (cron) y avisos de contrato

**Files:**
- Create: `src/app/api/cron/diario/route.ts`, `src/lib/jobs/diario.ts`, `vercel.json`
- Test: `tests/unit/jobs-diario.test.ts`

**Interfaces:**
- Produces: `ejecutarDiario(hoy: Date): Promise<{cargosGenerados: number; avisosContrato: number}>` — como usuario sistema (`usuarios` con rol `admin`, email `sistema@local`, creado por migración `0004`): `generar_cargos_renta(primer día del mes de hoy)`; para cada contrato con `estatus_calc='por_vencer'` sin fila en `avisos_enviados (tipo='contrato_por_vencer', referencia_id=contrato)` y con `avisos_contrato` del propietario → `sendEmail` y registra aviso. `GET /api/cron/diario` exige `Authorization: Bearer <CRON_SECRET>`; `vercel.json`: `{"crons":[{"path":"/api/cron/diario","schedule":"0 13 * * *"}]}` (07:00 CDMX).

- [ ] **Paso 1: Escribir `tests/unit/jobs-diario.test.ts`** — contrato vigente sin cargos del mes → `cargosGenerados 1`, segunda corrida `0`; contrato con `fecha_fin = hoy + 30` → `avisosContrato 1`, segunda corrida `0`; propietario con `avisos_contrato=false` → `0`.
- [ ] **Paso 2: Correr y ver que falla** — FAIL.
- [ ] **Paso 3: Implementar** `diario.ts`, la ruta (401 sin secreto) y `vercel.json`; agregar en `0004` el usuario sistema si no se hizo.
- [ ] **Paso 4: Correr y ver que pasa** — PASS.
- [ ] **Paso 5: Commit** — `git commit -am "feat: tarea diaria de cargos y avisos de contrato"`.

---

### Tarea 11: Portal del propietario

**Files:**
- Create: `src/lib/i18n/{index.ts,es.ts,en.ts}`, `src/app/clientes/{layout.tsx,page.tsx}`, `src/app/clientes/estados-de-cuenta/{page.tsx,[id]/page.tsx}`, `src/app/clientes/contratos/page.tsx`, `src/app/clientes/documentos/page.tsx`, `src/app/(auth)/login/page.tsx` (modificar: enlace de acceso por correo con proveedor supabase; con local, enlace a `/dev-login`), `src/lib/queries/portal.ts`
- Test: `tests/unit/i18n.test.ts`, `tests/e2e/portal.spec.ts`

**Interfaces:**
- Consumes: vistas `portal_*`, `getFileUrl`.
- Produces: `t(idioma, clave): string` con claves para toda la copia del portal (`resumen.titulo`, `estatus.pagado`, `estatus.pendiente`, `estatus.vencido`, `estatus.parcial`, `liquidacion.neto`, …); `portalResumen(session)`, `portalLiquidaciones(session)`, `portalLiquidacion(session, id)`, `portalContratos(session)`, `portalDocumentos(session)`. Layout del portal lee `portal_propietario.idioma` y pasa `t`.
- Resumen: totales del mes (esperado, cobrado, pendiente, vencido) + tabla de unidades con semáforo (verde pagado, ámbar pendiente/parcial, rojo vencido con días).

- [ ] **Paso 1: Escribir `tests/unit/i18n.test.ts`** — `t('en','estatus.vencido') === 'Overdue'`; toda clave de `es` existe en `en` (iterar).
- [ ] **Paso 2: Escribir `tests/e2e/portal.spec.ts`** — login dev como propA → resumen muestra sus unidades y no las de B; estados de cuenta lista sólo la cerrada; descarga PDF 200; `/app` como propA → 403 o redirect a `/clientes`; propietario con `idioma='en'` ve "Overdue"; `/api/archivos/propietarios/<B>/...` como propA → 403.
- [ ] **Paso 3: Correr y ver que fallan** — FAIL.
- [ ] **Paso 4: Implementar** i18n, consultas y páginas (sólo lectura; sin formularios).
- [ ] **Paso 5: Correr y ver que pasan** — PASS; `npx playwright test` completo PASS.
- [ ] **Paso 6: Commit** — `git commit -am "feat(portal): resumen, estados de cuenta, contratos y documentos en es/en"`.

---

### Tarea 12: Carga inicial del piloto y respaldo

**Files:**
- Create: `scripts/carga-inicial.ts`, `carga/ejemplo/{propietarios,inmuebles,unidades,inquilinos,contratos,saldos}.csv`, `scripts/backup.sh`, `.github/workflows/backup.yml`
- Test: `tests/unit/carga-inicial.test.ts`

**Interfaces:**
- Produces: `cargarInicial(dir: string, fechaArranque: string): Promise<{propietarios, inmuebles, unidades, contratos, saldos}>` — lee CSV (encabezados en español iguales a las columnas), inserta como usuario sistema, y por cada fila de `saldos.csv (contrato_ref, monto, descripcion)` crea un cargo `tipo='otro'`, `periodo = primer día del mes de arranque`, `fecha_limite = fechaArranque`, `notas = descripcion`. Idempotente por `ref` (columna `ref` en cada CSV guardada en `notas`/campo `ref_carga text` agregado en `0004`).
- `backup.sh`: `pg_dump "$DATABASE_ADMIN_URL" | gzip > backups/<fecha>.sql.gz`; si `STORAGE_PROVIDER=supabase`, descarga el bucket con `supabase storage cp -r`; sube `backups/` a Drive con `rclone copy backups/ gdrive:ctdisa/respaldos-plataforma` si `rclone` está configurado. `backup.yml`: cron semanal domingo 06:00 UTC con secretos `DATABASE_ADMIN_URL`, `RCLONE_CONFIG`.

- [ ] **Paso 1: Escribir `tests/unit/carga-inicial.test.ts`** — con `carga/ejemplo` → conteos esperados (2 propietarios, 2 inmuebles, 3 unidades, 3 contratos, 1 saldo); segunda corrida → todos `0`; el saldo aparece en `v_cargos` como `vencido` si `fechaArranque < hoy`.
- [ ] **Paso 2: Correr y ver que falla** — FAIL.
- [ ] **Paso 3: Implementar** script y CSV de ejemplo; `backup.sh` probado localmente (`bash scripts/backup.sh` genera `backups/*.sql.gz`).
- [ ] **Paso 4: Correr y ver que pasa** — PASS.
- [ ] **Paso 5: Commit** — `git commit -am "feat: carga inicial del piloto y respaldo semanal"`.

---

### Tarea 13: Despliegue — guía y verificación en Supabase + Vercel

**Files:**
- Create: `README.md` (secciones: requisitos, desarrollo local, pruebas, despliegue), `docs/despliegue.md`, `.env.example` (modificar)
- Test: verificación manual con lista de comprobación

**Interfaces:**
- `docs/despliegue.md` cubre, en orden: (1) crear proyecto Supabase (región us-east), (2) `supabase link` + `supabase db push` para aplicar `supabase/migrations`, (3) en SQL editor: `alter role app_server login password '<secreto>'` y crear el rol si la migración no lo hace (`create role app_server`), (4) crear bucket privado `archivos`, (5) habilitar Auth por correo con enlace mágico y plantilla en español, (6) crear el primer usuario admin: invitar por correo desde Supabase y `insert into usuarios (id, email, nombre, rol)`, (7) Vercel: importar repo, variables de entorno (`DATABASE_URL` con el rol `app_server` vía pooler, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `CRON_SECRET`, `AUTH_PROVIDER=supabase`, `STORAGE_PROVIDER=supabase`, `EMAIL_PROVIDER=resend`), dominios `app.ctdisa.com` y `clientes.ctdisa.com`, (8) Resend: verificar dominio `ctdisa.com`, (9) lista de comprobación post-despliegue: login admin, crear propietario de prueba, registrar pago, cerrar liquidación, abrir portal con usuario propietario, correr `/api/cron/diario` a mano.

- [ ] **Paso 1: Escribir `README.md` y `docs/despliegue.md`**.
- [ ] **Paso 2: Verificar que `npm run build` pasa** y que `npx vitest run && npx playwright test` están en verde desde cero (`bash scripts/db-local.sh reset rentas_test`).
- [ ] **Paso 3: Commit** — `git commit -am "docs: guía de despliegue y README"`.
- [ ] **Paso 4 (con Luis):** ejecutar la guía con sus cuentas y completar la lista de comprobación; registrar resultado en `docs/despliegue.md`.

---

## Autorrevisión (hecha)

- Cobertura del spec: §3 → T2–T5; §4 → T7–T9; §5 → T11; §6 → T6, T10, T12, T13; §7 → pruebas en cada tarea; §8 piloto → T12 (carga) + T13 (lista de comprobación); §9 decisiones pendientes → `recargo_visible`, `recargos_al_propietario` como opciones por propietario (T2) para no bloquear; plazo de objeción es contractual, fuera del código.
- Consistencia de nombres: `registrar_pago`, `cancelar_pago`, `preparar_liquidacion`, `cerrar_liquidacion`, `pagar_liquidacion`, `generar_cargos_renta`, `withSession`, `getSession`, `requireRol`, `putFile`, `getFileUrl`, `sendEmail`, `renderEstadoCuentaPdf` se usan con los mismos nombres en todas las tareas.
- Review Focus: 1–3 en T3, 4 en T4, 5 en T4 y T9.
