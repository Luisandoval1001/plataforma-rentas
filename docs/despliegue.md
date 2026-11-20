# Guía de despliegue y operación

Producción: **Supabase** (Postgres, Auth, Storage) + **Vercel** (aplicación) + **Resend** (correo) + **GitHub Actions** (respaldo semanal). Dominio `ctdisa.com`: `app.ctdisa.com` (equipo) y `clientes.ctdisa.com` (propietarios).

Sigue los pasos en orden. Lo que dice `<entre ángulos>` es un valor que tú obtienes; no lo escribas literal.

## Resumen de lo que debe existir antes de aplicar las migraciones

Las migraciones **no** crean roles. Deben existir:

| Elemento | Quién lo provee |
|---|---|
| Rol `authenticated` | Supabase |
| Rol `app_server` (con LOGIN) | **Tú**, paso 2 |

Las migraciones sí crean el esquema `app`, tablas, funciones, políticas RLS y los `grant ... to app_server, authenticated`. Si `app_server` no existe, la migración 0001 falla.

## 1. Crear el proyecto en Supabase

1. Entra a <https://supabase.com> → **New project**.
2. Organización: la de ctdisa. Nombre: `plataforma-rentas`. Región: **East US (North Virginia)**. Plan: Pro.
3. Guarda la **contraseña de la base de datos** (la llamaremos `<password-postgres>`).
4. Cuando termine de crearse, anota:
   - **Project ref**: está en la URL del panel (`https://supabase.com/dashboard/project/<project-ref>`).
   - **Project URL** y claves: Project Settings → API → `Project URL`, `anon public`, `service_role` (secreta).
   - **Cadena de conexión**: botón **Connect** (arriba) → pestaña *Session pooler* (puerto 5432, IPv4). Su forma es `postgresql://postgres.<project-ref>:<password-postgres>@<host-pooler>:5432/postgres`. La llamaremos `<URL-pooler-sesion>`.

## 2. Roles y ajustes de base de datos (SQL editor, ANTES de las migraciones)

En Supabase → **SQL Editor** → New query. Pega y ejecuta (cambia el secreto por uno fuerte y largo, sin `@`, `:`, `/` ni `#`, para no romper la URL; guárdalo como `<secreto-app-server>`):

```sql
create role app_server login password '<secreto-app-server>';
grant usage on schema public to app_server;
alter role app_server set timezone = 'America/Mexico_City';
```

Notas:
- `app_server` es el rol con el que se conecta la aplicación. **Está sujeto a RLS.** El usuario `postgres` salta RLS, por eso nunca se usa en `DATABASE_URL`.
- La aplicación se conecta directamente como `app_server`; no necesita ser miembro de ningún otro rol.
- **No se otorga nada sobre el esquema `auth`.** En Supabase el rol `postgres` no puede dar a un rol propio acceso a `auth` (el `grant` termina con una advertencia y no cambia nada). Por eso la plataforma usa su propia función `app.uid()`, que lee el mismo dato que `auth.uid()`.
- La aplicación fija la zona horaria en cada transacción; el `alter role` cubre cualquier otra conexión de `app_server`.
- **Atajo:** `bash scripts/generar-instalacion.sh '<secreto-app-server>' > instalacion.sql` genera un solo archivo con este paso y todas las migraciones (paso 3) para pegarlo completo en el SQL Editor. Con `--demo` agrega datos ficticios (ver "Instalación de demostración" al final).

## 3. Aplicar las migraciones

Elige **una** opción. Se corren desde tu computadora, en la carpeta del repo.

**Opción A — `supabase db push`:**

```bash
npx supabase login
npx supabase init                                  # sólo la primera vez: el repo no trae supabase/config.toml
npx supabase link --project-ref <project-ref>     # pide <password-postgres>
npx supabase db push
```

**Opción B — script del repo** (usa la URL del pooler de sesión, o la conexión directa si tu red tiene IPv6):

```bash
npm install
DATABASE_ADMIN_URL='<URL-pooler-sesion>' npm run migrate
```

Debe imprimir `0001_core.sql` … `0009_ajustes_revision.sql` sin errores. No ejecutes una opción después de la otra sobre la misma base: la B vuelve a aplicar todo y fallaría. Si una migración falla a medias, repórtalo; cada archivo corre en su propia transacción.

## 4. Endurecer privilegios

La migración `0008_hardening.sql` (ya aplicada en el paso 3) quita los privilegios por defecto de Supabase: `anon` queda sin acceso, `authenticated` queda sin TRUNCATE y sin escritura directa sobre pagos, liquidaciones, ajustes y bitácora, y las tablas/funciones futuras ya no se otorgan automáticamente. Asume que las migraciones corren como `postgres` (así es en Supabase); si no, repite sus sentencias `alter default privileges` con `for role <ese rol>`.

Lo único manual es quitar `/dev-login` (la migración 0005 lo otorga a `app_server` para desarrollo local). En el SQL Editor:

```sql
revoke execute on function app.usuarios_dev_login() from app_server, authenticated;
```

Comprobación: `select current_setting('app.dev_login', true);` debe devolver vacío o `NULL`. Nunca ejecutes `alter database ... set app.dev_login`.

## 5. Storage: bucket privado

1. Supabase → **Storage** → **New bucket**.
2. Nombre exacto: `archivos`. **Public bucket: apagado** (privado).
3. No agregues políticas: la aplicación accede con la clave `service_role` y entrega URLs firmadas de 1 hora.

## 6. Auth: correo, enlace mágico, sesiones y API

En V1 todos (equipo y propietarios) entran con **enlace de acceso por correo**; la contraseña es opcional. El enlace usa el flujo de *token hash*: funciona aunque se abra en otro dispositivo o navegador que aquel donde se pidió.

1. Supabase → **Authentication** → **Sign In / Providers** → **Email**: activar **Enable Email provider** y dejar **Confirm email** encendido. **Email OTP Expiration** = `900` segundos (el enlace vence en 15 min). Apaga el registro libre (*Allow new users to sign up*): los usuarios se crean sólo por invitación.
2. **Authentication** → **URL Configuration**:
   - **Site URL:** `https://clientes.ctdisa.com`
   - **Redirect URLs** (agregar ambas):
     - `https://clientes.ctdisa.com/auth/callback`
     - `https://app.ctdisa.com/auth/callback`
3. **Authentication** → **Email Templates**. Reemplaza el contenido de *Magic Link* e *Invite user* por el de abajo (copia exacta; las variables `{{ ... }}` las llena Supabase). **No uses `{{ .ConfirmationURL }}`**: ese enlace depende de un dato guardado en el navegador donde se pidió y falla si se abre en otro dispositivo.

   *Magic Link* — Asunto: `Tu enlace de acceso a DISA`

   ```html
   <p>Hola:</p>
   <p>Haz clic para entrar a la plataforma de DISA. El enlace vence en 15 minutos y sólo sirve una vez:</p>
   <p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">Entrar</a></p>
   <p>Si no lo solicitaste, ignora este correo.</p>
   ```

   `{{ .RedirectTo }}` es el `/auth/callback` del sitio donde la persona pidió el enlace (`app.ctdisa.com` para el equipo, `clientes.ctdisa.com` para propietarios); la aplicación lo envía y debe estar en *Redirect URLs*. (Con `{{ .SiteURL }}/auth/callback` el equipo terminaría en `clientes.ctdisa.com` y no podría entrar a la aplicación.)

   *Invite user* — Asunto: `Te invitamos a la plataforma de DISA`

   ```html
   <p>Hola:</p>
   <p>Casas y Terrenos DISA te invitó a su plataforma. Para activar tu acceso haz clic aquí:</p>
   <p><a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite">Activar mi acceso</a></p>
   <p>Si no esperabas este correo, ignóralo.</p>
   ```

   La invitación activa la cuenta y deja dentro al propietario. Si quien la acepta es del equipo, la aplicación lo lleva a `https://app.ctdisa.com/login` para que pida ahí su enlace (su sesión vive en ese dominio).
4. **Authentication** → **Sessions** (plan Pro): **Time-box user sessions** = `12` horas e **Inactivity timeout** = `12` horas. Así ninguna sesión dura más de 12 h.
5. **Cerrar sesiones de alguien / quitar acceso:** en la aplicación, `https://app.ctdisa.com/app/usuarios` (equipo) o la ficha del propietario (usuarios del portal) → **Desactivar**. El usuario pierde todo acceso a los datos de inmediato y se bloquea en Supabase Auth (se revocan sus sesiones). **Reactivar** lo devuelve.
6. **Contraseña (opcional, sólo si alguien del equipo la prefiere al enlace):** Supabase no tiene un campo para escribirla en el panel; se fija con la API de administración ([`updateUserById`](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid)). Desde tu computadora:

   ```bash
   curl -X PUT 'https://<project-ref>.supabase.co/auth/v1/admin/users/<uid>' \
     -H 'apikey: <service_role>' -H 'Authorization: Bearer <service_role>' \
     -H 'Content-Type: application/json' -d '{"password":"<contraseña larga>"}'
   ```

   Después entra en `/login` con correo y contraseña. Comparte la contraseña por un medio seguro.
7. **Data API y GraphQL apagados** (la aplicación se conecta directo a Postgres y nunca usa la API REST ni GraphQL de Supabase; así nadie puede consultar tablas con la clave `anon` aunque un permiso quedara mal):
   - Project Settings → **Data API**: apaga **Enable Data API**. Si tu panel no tiene ese interruptor, en **Exposed schemas** quita `public` (y deja la lista vacía o sólo `graphql_public`).
   - En el **SQL Editor**: `drop extension if exists pg_graphql;` (desactiva GraphQL; se puede volver a crear desde Database → Extensions).
8. Más adelante (paso 10), al verificar el dominio en Resend, configura **Authentication → SMTP Settings** con las credenciales SMTP de Resend para que los correos de Auth salgan de `no-reply@ctdisa.com` (el SMTP integrado de Supabase tiene límite bajo de envíos y es sólo de pruebas).

## 7. Primer usuario admin y usuarios del equipo

El `id` de la tabla `usuarios` debe ser el mismo UUID del usuario de Supabase Auth.

1. Supabase → **Authentication** → **Users** → **Invite user** → escribe el correo del admin → *Invite*.
2. En la lista de usuarios, copia su **UID** (UUID).
3. En **SQL Editor** ejecuta (con tus datos) **antes** de que la persona abra el correo de invitación (si lo abre antes, el enlace la regresa al login con error; basta con que pida un enlace nuevo en `/login`):

   ```sql
   insert into usuarios (id, email, nombre, rol)
   values ('<uuid>', '<correo>', '<nombre>', 'admin');
   ```
4. La persona hace clic en **Activar mi acceso** del correo de invitación; queda activada y la aplicación la lleva a `https://app.ctdisa.com/login`, donde pide su enlace de acceso con el mismo correo.

Para cada persona del equipo: igual (invitar, copiar UUID, `insert`) con `rol` = `equipo`.
Los **propietarios no se crean aquí**: se invitan desde la app, en `/app/propietarios/<id>` → botón **Invitar** (punto 10 de la lista de comprobación).

## 8. Vercel

1. <https://vercel.com> → **Add New → Project** → importa el repositorio de GitHub. Framework: Next.js (se detecta). Raíz: la del repo.
2. **Settings → Environment Variables** (entorno *Production*). Valores exactos:

| Variable | Valor en producción |
|---|---|
| `AUTH_PROVIDER` | `supabase` |
| `STORAGE_PROVIDER` | `supabase` |
| `EMAIL_PROVIDER` | `resend` |
| `DATABASE_URL` | Pooler de **sesión** con el rol de la app: `postgresql://app_server.<project-ref>:<secreto-app-server>@<host-pooler>:5432/postgres` (mismo host y puerto que `<URL-pooler-sesion>`, cambiando el usuario a `app_server.<project-ref>` y la contraseña a `<secreto-app-server>`). **Debe ser `app_server`, no `postgres`:** el usuario `postgres` salta RLS y cualquier propietario vería datos ajenos. |
| `DATABASE_ADMIN_URL` | No se define en Vercel (sólo migraciones y respaldos, fuera de la app). |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL (`https://<project-ref>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave `anon public` |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave `service_role` (secreta; sólo servidor) |
| `RESEND_API_KEY` | API key de Resend (paso 10) |
| `EMAIL_FROM` | `DISA <no-reply@ctdisa.com>` |
| `CRON_SECRET` | Cadena aleatoria larga (p. ej. `openssl rand -hex 32`). Vercel la envía sola a las rutas cron como `Authorization: Bearer <CRON_SECRET>`. |
| `SESSION_SECRET` | Cadena aleatoria larga. No se usa con `AUTH_PROVIDER=supabase`, pero no puede estar vacía. |
| `APP_URL` | `https://app.ctdisa.com` |
| `CLIENTES_URL` | `https://clientes.ctdisa.com` |
| `TZ` | `America/Mexico_City` |

   `STORAGE_LOCAL_ROOT` y `EMAIL_LOCAL_DIR` son sólo locales: no se definen.
3. **Deploy**. Si ya se desplegó antes de poner las variables, haz *Redeploy*.
4. **Settings → Domains**: agrega `app.ctdisa.com` y `clientes.ctdisa.com`. Vercel muestra para cada uno un registro **CNAME** (normalmente `cname.vercel-dns.com`). En el proveedor de DNS de `ctdisa.com` crea:

   | Tipo | Nombre | Valor |
   |---|---|---|
   | CNAME | `app` | el valor que indique Vercel |
   | CNAME | `clientes` | el valor que indique Vercel |

   Espera a que Vercel marque ambos dominios como *Valid Configuration*.
5. **Cron:** `vercel.json` define `/api/cron/diario` todos los días a las **13:00 UTC** (07:00 hora de CDMX, que ya no cambia de horario). Se ve en Settings → Cron Jobs tras el primer despliegue. Los crons de Vercel sólo corren en el despliegue de Production.

## 9. Pruebas rápidas de arranque

- `https://app.ctdisa.com/login` carga la pantalla de acceso.
- `https://app.ctdisa.com/dev-login` responde **404**.

## 10. Resend: dominio y remitente

1. <https://resend.com> → **Domains** → **Add Domain** → `ctdisa.com` (región us-east-1).
2. Resend muestra registros DNS (SPF `TXT`, DKIM `TXT`/`CNAME`, y `MX` para el subdominio `send`). Créalos tal cual en el DNS de `ctdisa.com` → **Verify**. Espera a *Verified*.
3. **API Keys** → crear una con permiso *Sending access* → copiarla a `RESEND_API_KEY` en Vercel.
4. `EMAIL_FROM` = `DISA <no-reply@ctdisa.com>` (debe ser un correo del dominio verificado).
5. Para los correos de Auth: **SMTP** de Resend (host `smtp.resend.com`, puerto `465`, usuario `resend`, contraseña = la API key) en Supabase → Authentication → SMTP Settings, remitente `no-reply@ctdisa.com`.
6. *Redeploy* en Vercel tras cambiar variables.

## 11. Respaldo semanal (GitHub Actions)

El workflow `.github/workflows/backup.yml` corre los domingos 06:00 UTC y guarda el volcado de la base y los archivos como *artifact* (30 días) y en Google Drive.

1. **El repositorio debe ser privado** (los volcados contienen datos personales).
2. **Google Drive con rclone** (en tu computadora, una sola vez):
   1. Crea en el Drive de ctdisa la carpeta `respaldos-plataforma`.
   2. Instala rclone y corre `rclone config` → *New remote* → nombre `gdrive` → tipo `drive` → completa el acceso (scope `drive`) con la cuenta de ctdisa.
   3. Prueba: `rclone lsd gdrive:` debe listar el Drive.
   4. Muestra la configuración: `rclone config show gdrive` y copia todo el bloque (incluye `[gdrive]` y el token).
3. GitHub → repo → **Settings → Secrets and variables → Actions → New repository secret**. Crea:

   | Secreto | Valor |
   |---|---|
   | `DATABASE_ADMIN_URL` | `<URL-pooler-sesion>` (usuario `postgres.<project-ref>`, pooler de **sesión**, IPv4; GitHub no tiene IPv6) |
   | `SUPABASE_ACCESS_TOKEN` | Supabase → Account → Access Tokens → *Generate new token* |
   | `SUPABASE_PROJECT_REF` | `<project-ref>` |
      | `RCLONE_CONFIG` | el bloque de `rclone config show gdrive` |
   | `RCLONE_REMOTE` | `gdrive:respaldos-plataforma` |

   (Si `supabase link` llegara a pedir la contraseña de la base, agrega también `SUPABASE_DB_PASSWORD` y pásala en el `env` del paso *Enlazar proyecto* del workflow.)

4. **Actions → Respaldo semanal → Run workflow** (`workflow_dispatch`) una vez. Debe terminar en verde y aparecer un archivo `.sql.gz` en la carpeta `respaldos-plataforma` de Drive.
5. **Restaurar.** El volcado trae sólo los esquemas `public` y `app` (tablas, datos, funciones, vistas, RLS), sin dueños ni privilegios, y **no** trae los usuarios de Supabase Auth. Pasos, en un proyecto Supabase nuevo y vacío:
   1. Paso 2 de esta guía (crear `app_server` con sus `grant` y las zonas horarias). No apliques las migraciones: ya vienen dentro del volcado.
   2. Carga el volcado con la URL del pooler de sesión del proyecto nuevo:
      `gunzip -c backups/<fecha>.sql.gz | psql -v ON_ERROR_STOP=1 "$DATABASE_ADMIN_URL"`
   3. Reaplica los privilegios (no uses `npm run migrate`: las migraciones no son idempotentes):
      `psql -v ON_ERROR_STOP=1 -f scripts/reaplicar-permisos.sql "$DATABASE_ADMIN_URL"`. Ese archivo ya incluye la revocación de `app.usuarios_dev_login`.
   4. Pasos 5 (bucket), 6 (Auth) y 8 (variables de Vercel con el proyecto nuevo) de esta guía.
   5. **Usuarios:** en Authentication → Users re-invita a cada persona (equipo y propietarios; la lista sale de `select email, rol from usuarios where activo order by rol, email;`) y copia su UID nuevo. Edita `scripts/remapear-usuarios.sql` con un renglón `('<correo>', '<uid nuevo>')` por persona y ejecútalo completo como `postgres`:
      `psql -v ON_ERROR_STOP=1 -f scripts/remapear-usuarios.sql "$DATABASE_ADMIN_URL"`. Cambia `usuarios.id` y todas las columnas que lo referencian (`propietario_usuarios`, `inmuebles.cobrador_id`, `cargos.creado_por`, `pagos.registrado_por/cancelado_por`, `gastos.registrado_por`, `liquidaciones.cerrada_por`, `documentos.subido_por`, `ajustes_pendientes.creado_por`). Su núcleo:

      ```sql
      begin;
      set local session_replication_role = replica;  -- sin triggers ni revisión de FK sólo en esta transacción
      create temp table remapeo (email text primary key, nuevo uuid not null) on commit drop;
      insert into remapeo values ('luis@ctdisa.com', '<uid nuevo>');  -- un renglón por usuario
      create temp table mapa on commit drop as
        select u.id as viejo, r.nuevo from usuarios u join remapeo r on lower(r.email) = lower(u.email);
      update usuarios t set id = m.nuevo from mapa m where t.id = m.viejo;
      update propietario_usuarios t set usuario_id = m.nuevo from mapa m where t.usuario_id = m.viejo;
      -- … y las demás columnas de la lista (ver el archivo)
      commit;
      ```
   6. Archivos: ver la cabecera de `scripts/backup.sh`.
   7. Lista de comprobación del paso 13 (1, 7–9, 11–12).

   **Ensaya una restauración completa** (en un proyecto de prueba) antes del piloto y después cada pocos meses: un respaldo que nunca se ha restaurado no es un respaldo. (La prueba automática `tests/unit/backup.test.ts` hace este mismo recorrido contra Postgres local.)

## 12. Carga inicial del piloto

Un conjunto de CSV por cliente en `carga/<cliente>/` (copia `carga/ejemplo/` y reemplaza el contenido). UTF-8, encabezado exacto, los valores con comas van entre comillas. Cada fila lleva un `ref` propio (p. ej. `PROP-001`) que sirve para ligar archivos entre sí y para que la carga sea **idempotente**: repetirla no duplica lo ya cargado.

| Archivo | Columnas |
|---|---|
| `propietarios.csv` | `ref,nombre,rfc,modelo,comision_pct,contacto_email,contacto_tel,idioma,recargo_visible,recargos_al_propietario` — `modelo`: `cobra_disa` o `cobra_propietario`; `comision_pct`: número (15); `idioma`: `es` o `en` |
| `inmuebles.csv` | `ref,propietario_ref,nombre,direccion,tipo` — `tipo`: `departamento, casa, edificio, local, terreno, nave, otro` |
| `unidades.csv` | `ref,inmueble_ref,nombre` |
| `inquilinos.csv` | `ref,nombre,email,telefono,rfc` (correo, teléfono y RFC pueden ir vacíos) |
| `contratos.csv` | `ref,unidad_ref,inquilino_ref,fecha_inicio,fecha_fin,renta_mensual,dia_pago,deposito,incremento_anual_pct,estatus,primer_periodo_cargo` — fechas `AAAA-MM-DD`; `estatus`: `vigente, pendiente_firma, terminado`; una sola unidad no puede tener dos contratos vigentes; `primer_periodo_cargo` `AAAA-MM`, opcional (ver abajo) |
| `saldos.csv` | `ref,contrato_ref,periodo,monto,descripcion` — `periodo` `AAAA-MM` |

- Columnas de sí/no (`recargo_visible`, `recargos_al_propietario`): se aceptan `true/false`, `sí/no`, `1/0`.
- **Saldos** = rentas abiertas (no pagadas) por mes, una fila por mes y contrato; se cargan como cargos de renta de ese mes. **No se cargan pagos históricos.**
- **`primer_periodo_cargo`** = primer mes que el sistema debe cobrar; si la renta del mes de arranque ya se cobró fuera del sistema, pon el mes siguiente. Vacío → desde el mes de `fecha_inicio`. No puede ser anterior al mes de `fecha_inicio`. (Los meses anteriores que se deben van en `saldos.csv`.)
- **`renta_mensual`** = la renta pactada al inicio del contrato (`fecha_inicio`). En contratos de varios años el sistema aplica `incremento_anual_pct` por cada año cumplido (año 1: renta; año 2: renta × (1 + %); año 3: × (1 + %)², …). Si en la práctica ya se cobra otra renta, revisa que cuadre con esa regla antes de cargar.
- Orden de armado: propietarios → inmuebles → unidades → inquilinos → contratos → saldos. Cada `*_ref` debe existir en su archivo.

Ejecución (desde el repo, con la URL de `app_server`; el segundo argumento es la fecha de arranque del piloto):

```bash
DATABASE_URL='postgresql://app_server.<project-ref>:<secreto-app-server>@<host-pooler>:5432/postgres' \
  npx tsx scripts/carga-inicial.ts carga/<cliente> <AAAA-MM-DD>
```

Todo ocurre en una sola transacción: si hay un error, no se carga nada y el mensaje indica archivo, línea y referencia. Corrige el CSV y repite. Al terminar imprime los conteos por tabla.

## 13. Lista de comprobación posterior al despliegue

Marca cada punto; si alguno falla, detente y corrige antes de seguir.

- [ ] 1. `https://app.ctdisa.com/login`: entrar como admin (enlace de acceso o contraseña) y llegar al tablero.
- [ ] 2. Crear un propietario de prueba (modelo `cobra_disa`, comisión 15).
- [ ] 3. Crear un inmueble y una unidad del propietario.
- [ ] 4. Crear un inquilino.
- [ ] 5. Crear un contrato vigente para esa unidad.
- [ ] 6. Generar los cargos del mes y ver el cargo de renta.
- [ ] 7. Registrar un pago y adjuntar comprobante; el comprobante se abre.
- [ ] 8. El tablero refleja el cargo y el pago.
- [ ] 9. Preparar una liquidación del propietario, cerrarla (admin) y abrir su PDF.
- [ ] 10. En `/app/propietarios/<id>` → **Invitar**: invitar un correo propio como usuario del propietario de prueba.
- [ ] 11. Abrir `https://clientes.ctdisa.com/login`, pedir el enlace de acceso, entrar con el enlace del correo.
- [ ] 12. En el portal: resumen, estado de cuenta y su PDF se ven; el usuario no puede abrir `https://app.ctdisa.com/app`.
- [ ] 13. Llamar el cron a mano; debe responder JSON sin error:

  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://app.ctdisa.com/api/cron/diario
  ```
  (sin el encabezado debe responder 401).
- [ ] 14. Ejecutar el workflow de respaldo (paso 11.4) y confirmar el archivo en Drive.
- [ ] 15. `https://app.ctdisa.com/dev-login` y `https://clientes.ctdisa.com/dev-login` responden **404**.
- [ ] 15b. La API REST está apagada: `curl 'https://<project-ref>.supabase.co/rest/v1/usuarios' -H 'apikey: <anon public>'` **no** devuelve datos (error o 404).
- [ ] 15c. Abrir el enlace de acceso del correo en **otro** dispositivo (p. ej. pedirlo en la computadora y abrirlo en el celular) entra sin error.
- [ ] 16. Borrar o dejar claramente marcados los datos de prueba antes del piloto real.

Registro de la ejecución con Luis (completar):

| Fecha | Quién | Resultado | Pendientes |
|---|---|---|---|
|  |  |  |  |

## 14. Operación mensual

1. **Día 1:** el cron diario genera automáticamente los cargos de renta del mes.
2. **Diario:** cobranza — registrar pagos con comprobante, revisar vencidos y por vencer en el tablero.
3. **Cierre de mes** (por propietario, a partir del día 1 del mes siguiente; `/app/liquidaciones` abre en el mes anterior): **preparar** la liquidación (equipo) → **revisar** → **cerrar** (sólo admin; queda inmutable y se avisa al propietario por correo) → **transferir** al propietario → **registrar el pago de la liquidación** (queda `pagada`). El sistema no deja cerrar el mes en curso ni un mes si el propietario tiene uno anterior en borrador: se cierran en orden.
   - El neto se calcula con la **cuenta destino de cada pago**: neto = cobrado en cuenta DISA − comisión − IVA − gastos pagados por DISA ± ajustes (comisión e IVA sobre todo lo cobrado, en cualquier cuenta). Por eso al registrar un pago hay que elegir bien la cuenta (por omisión: DISA si el propietario es "Cobra DISA"; la del propietario si no).
4. Correcciones posteriores al cierre: se capturan como ajuste y salen en la siguiente liquidación.
5. **Renovaciones:** si la renovación se activa antes de que termine el contrato anterior, el anterior se sigue cobrando hasta su fecha de fin y la renovación desde el mes siguiente.
6. **Archivos:** comprobantes, PDF y documentos de hasta **4 MB** (límite de Vercel). Fotos grandes: reduce la resolución; PDF escaneados: comprímelos.
7. **Objeción del propietario:** 10 días hábiles después del cierre (plazo contractual; debe constar en el contrato de administración).
8. **Semanal:** revisar que el respaldo del domingo terminó en verde.

## 15. Instalación de demostración (datos ficticios)

Para enseñar la plataforma sin datos reales ni correos. Se entra eligiendo un usuario en `/dev-login`; una franja amarilla recuerda que es una demo.

1. Proyecto nuevo de Supabase (paso 1). Genera el instalador y pégalo completo en el SQL Editor:
   ```bash
   bash scripts/generar-instalacion.sh --demo '<secreto-app-server>' > instalacion-demo.sql
   ```
   Crea `app_server`, aplica las migraciones, crea el bucket `archivos`, enciende el interruptor de `/dev-login` (`app.configuracion`) y carga `demo/datos-demo.sql`. Al final muestra una tabla de revisión: todas las filas deben decir "sí".
2. Vercel (paso 8) con estas variables en lugar de las de producción:

   | Variable | Valor |
   |---|---|
   | `MODO_DEMO` | `1` |
   | `AUTH_PROVIDER` | `local` |
   | `STORAGE_PROVIDER` | `supabase` |
   | `EMAIL_PROVIDER` | `local` |
   | `EMAIL_LOCAL_DIR` | `/tmp/emails` |
   | `DATABASE_URL` | pooler de sesión con el usuario `app_server.<project-ref>` |
   | `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | del proyecto |
   | `SESSION_SECRET`, `CRON_SECRET` | aleatorios |
   | `APP_URL`, `CLIENTES_URL` | la dirección `https://<proyecto>.vercel.app` |

3. **Pasar de demo a producción:** proyecto nuevo de Supabase sin `--demo` (o, en el mismo, borrar el renglón `dev_login` de `app.configuracion` y revocar `app.usuarios_dev_login`, paso 4), quitar `MODO_DEMO`, cambiar a `AUTH_PROVIDER=supabase` / `EMAIL_PROVIDER=resend` y rotar la clave de `app_server`. `AUTH_PROVIDER=local` sólo arranca en producción con `MODO_DEMO=1`.
