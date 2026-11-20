# Plataforma de rentas — Casas y Terrenos DISA

Plataforma de administración de rentas para Casas y Terrenos DISA (CDMX). Una sola aplicación Next.js 16 con dos entradas por subdominio:

- `app.ctdisa.com` — aplicación del equipo (admin y equipo): propietarios, inmuebles, unidades, inquilinos, contratos, cobranza, gastos, liquidaciones.
- `clientes.ctdisa.com` — portal del propietario: resumen, estados de cuenta (PDF), contratos y documentos.

Datos en Postgres 16 con Row Level Security (RLS). Producción: Supabase (Postgres, Auth, Storage) + Vercel; correo con Resend. Diseño completo: `docs/superpowers/specs/2026-11-03-plataforma-rentas-design.md`.

## Estructura del repo

| Ruta | Contenido |
|---|---|
| `src/app/app`, `src/app/clientes` | Pantallas del equipo y del portal |
| `src/app/(auth)`, `src/app/auth` | Login, `/dev-login` (sólo local), callback del enlace de acceso |
| `src/app/api/cron/diario` | Tarea diaria (cargos del día 1, por vencer, avisos) |
| `src/proxy.ts`, `src/lib/routing.ts` | Reparto por subdominio (`app.*` → `/app`, `clientes.*` → `/clientes`) |
| `src/lib/auth`, `storage`, `email` | Proveedores intercambiables: `local` o `supabase` / `resend` |
| `supabase/migrations` | Esquema, RLS y funciones SQL (0001–0010) |
| `supabase/local` | Roles y réplica del esquema `auth` de Supabase para Postgres local |
| `demo/`, `scripts/generar-instalacion.sh` | Datos ficticios e instalador de un solo archivo (demo o producción) |
| `scripts/` | `db-local.sh`, `migrate.ts`, `carga-inicial.ts`, `backup.sh`, `reaplicar-permisos.sql`, `remapear-usuarios.sql` |
| `carga/ejemplo` | CSV de ejemplo para la carga inicial |
| `tests/unit`, `tests/db`, `tests/e2e` | Vitest (unidad y base de datos) y Playwright |
| `.github/workflows/backup.yml` | Respaldo semanal |
| `docs/despliegue.md` | Guía de despliegue y operación |

## Requisitos

- Node.js 22
- Postgres 16 local (cluster `16 main`; `scripts/db-local.sh` lo arranca y requiere `sudo`/usuario `postgres`)

## Desarrollo local

```bash
npm install
npm run db:start      # arranca Postgres local, fija contraseña de postgres y crea el rol app_server
npm run db:reset      # recrea la base rentas_test y aplica las migraciones
cp .env.test .env.local   # variables locales (BD rentas_test, proveedores local); Next.js carga .env.local
npm run dev           # http://localhost:3000
```

- Abre `http://localhost:3000/dev-login` para entrar como cualquier usuario activo (sólo con `AUTH_PROVIDER=local`; no existe en producción).
- Para tener usuarios de prueba, ejecuta la carga de ejemplo o crea filas en `usuarios`.
- `.env.example` documenta todas las variables.
- Para probar los subdominios en local, apunta `app.localhost` y `clientes.localhost` al puerto 3000; el reparto es por nombre de host.

## Pruebas

```bash
npm run db:reset      # base limpia antes de correr pruebas
npm test              # Vitest: unidad + base de datos (usa .env.test)
npm run test:e2e      # Playwright (levanta next dev en el puerto 3100 con su propia BD de prueba)
npx tsc --noEmit
npm run build
```

La primera vez, `npx playwright install chromium`.

## Despliegue

Ver [`docs/despliegue.md`](docs/despliegue.md): Supabase, Vercel, Resend, respaldos, carga inicial del piloto y lista de comprobación.

## Decisiones clave

- **El dinero sólo se mueve con funciones SQL** (`security definer`). Pagos, aplicaciones, liquidaciones, ajustes y bitácora no tienen privilegio de escritura directa para `app_server` ni `authenticated` (la migración `0008_hardening.sql` lo garantiza también en Supabase, donde los privilegios por defecto serían más amplios); la aplicación sólo llama funciones.
- **RLS en la base de datos.** Cada fila lleva `propietario_id`; un propietario no puede leer filas ajenas aunque manipule la aplicación. La app se conecta como `app_server` (sujeto a RLS) y fija el usuario de la petición (`app.uid()`) por transacción; no depende del esquema `auth` de Supabase, al que un rol propio no puede tener acceso. El usuario `postgres` salta RLS: nunca se usa en `DATABASE_URL`.
- **Zona horaria `America/Mexico_City`** en la app (`ZONA_HORARIA`), en la sesión de BD, en la base y en Vercel (`TZ`). `current_date` y `now()` son hora de CDMX.
- **Dos modelos de dinero por propietario, liquidación por cuenta.** `cobra_disa` / `cobra_propietario` es el dato de referencia y decide la cuenta destino por omisión al registrar un pago; el neto se calcula con la cuenta real de cada pago: neto = cobrado en cuenta DISA − comisión − IVA − gastos pagados por DISA + ajustes (comisión e IVA sobre todo lo cobrado). Con todos los pagos en una sola cuenta da lo mismo que los dos modelos originales; con cuentas mezcladas también cuadra. Las cancelaciones posteriores al cierre generan el ajuste según la cuenta del pago.
- **Liquidación inmutable y en orden.** Sólo el admin cierra; no se cierra el mes en curso ni uno con un mes anterior en borrador (`/app/liquidaciones` y el tablero trabajan sobre el mes anterior). Cerrada no se modifica; las correcciones posteriores entran como `ajustes_pendientes` (auditados en bitácora) en la siguiente liquidación.
- **Cargos de renta:** el día 1 por contrato vigente, desde `contratos.cargos_desde` (por omisión `fecha_inicio`; en la carga inicial, `primer_periodo_cargo`), con el incremento anual compuesto por año cumplido (`app.renta_vigente`). Una renovación activada antes del fin del contrato anterior no corta su renta: el anterior se cobra hasta su `fecha_fin` y la renovación desde el mes siguiente.
- **Acceso:** enlace por correo con *token hash* (sirve en otro dispositivo) para todos; contraseña opcional; sesiones de 12 h (configuración de Supabase). Un usuario desactivado (`/app/usuarios`, ficha del propietario) no lee nada en la BD aunque conserve una sesión, y se bloquea en Supabase Auth.
- **Archivos de hasta 4 MB** (límite de cuerpo de Vercel).
- **Respaldo** de los esquemas `public` y `app`, restaurable en un proyecto Supabase nuevo (`docs/despliegue.md` §11.5).
- **Bitácora inmutable** de movimientos; sin UPDATE/DELETE para ningún rol de aplicación.
- **Estatus calculados**, nunca guardados (vistas `v_cargos`, `v_contratos`).

## Fase 2 (fuera de alcance en V1, orden sugerido)

1. Tickets de mantenimiento con autorización del propietario desde el portal.
2. Recordatorios de cobranza con historial y paso a jurídico (día 30 / día 60).
3. Facturación CFDI desde el sistema.
4. Avisos por WhatsApp.
5. Lectura de estados de cuenta bancarios para conciliar pagos.
6. Reparto entre copropietarios.
7. Módulo de vacantes y promoción.
8. Acceso de inquilinos.
9. Subida directa a Storage para archivos grandes (hoy el tope es 4 MB por archivo).
10. Segundo factor para el equipo: código por correo al entrar desde un dispositivo nuevo.
