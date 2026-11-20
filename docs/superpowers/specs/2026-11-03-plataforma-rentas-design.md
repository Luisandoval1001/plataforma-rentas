# Plataforma de administración de rentas — Diseño

Fecha: 2026-11-03
Estado: aprobado en conversación; pendiente de revisión escrita por Luis
Alcance: V1 (control interno del equipo + portal del propietario) para inmuebles de terceros administrados por Casas y Terrenos DISA

## 1. Objetivo y contexto

- Dos tipos de usuario: (a) propietarios que contratan la administración de rentas y quieren ver el estatus de sus rentas en tiempo real; (b) el equipo de DISA (Isaac, Michelle, Guadalupe, Jaquelin) que lleva cobranza, contratos, gastos y liquidaciones, supervisado por Luis (admin).
- "Tiempo real" significa: en cuanto el equipo registra un pago, el propietario lo ve. No hay integración bancaria en V1.
- Éxito: el propietario deja de preguntar "¿ya pagó?" porque lo ve solo; Luis deja de armar el reporte mensual a mano; el estado de cuenta del sistema cuadra peso por peso con el método actual.
- RentioPro se queda para los ~180 contratos propios de DISA. Esta plataforma es sólo para terceros (decisión de Luis; RentioPro se le complica a la estructura de DISA y le falta facilidad de uso).
- Escala objetivo: ~100 unidades y 10–30 propietarios en 12 meses (incluye el edificio de 16 unidades en Col. Cuauhtémoc, ya confirmado).
- Presupuesto de herramientas: $25–45 USD/mes (≈ $500–900 MXN/mes), sin costo por propietario ni por unidad.

## 2. Dos modelos de dinero (conviven por propietario)

| Modelo | Quién recibe la renta | Cómo se registra el pago | Liquidación |
|---|---|---|---|
| Cobra DISA | Cuenta de DISA | El equipo lo identifica en el estado de cuenta de DISA y lo registra | DISA transfiere al propietario: cobrado − comisión − IVA de comisión − gastos pagados por DISA |
| Cobra propietario | Cuenta del propietario | El propietario autoriza un usuario de consulta a su banca; el equipo revisa y registra | Neto negativo: el propietario debe a DISA la comisión + IVA (menos/más gastos según quién los pagó) |

En ambos casos el pago lo registra el equipo manualmente, con comprobante.

## 3. Modelo de datos

### Entidades

1. **Propietario** — nombre/razón social, RFC, contactos, modelo de dinero (cobra DISA / cobra propietario), % de comisión (15, 12 o personalizado), cuenta para liquidación (sólo últimos 4 dígitos), opción "recargo por mora visible" (sí/no), idioma preferido (es/en), preferencias de avisos por correo. Uno o varios usuarios de portal (p. ej. tres hermanos Villalongin; tres copropietarios de Cuauhtémoc) ven la misma cuenta.
2. **Inmueble** — dirección, tipo (departamento, edificio, local, terreno, nave), propietario, cobrador asignado (usuario del equipo).
3. **Unidad** — cada cosa rentable dentro del inmueble (depto 407, local A). Un departamento suelto = inmueble con una unidad.
4. **Inquilino** — nombre, contacto, RFC (para factura).
5. **Contrato** — unidad + inquilino, inicio, fin, renta mensual, día de pago, depósito en garantía, incremento anual pactado, PDF, estatus (vigente / por vencer [≤60 días] / vencido / terminado), y para renovaciones: "pendiente de firma" desde fecha X.
6. **Cargo** — lo que el inquilino debe en un periodo. Tipo (renta, recargo, otro), monto, fecha límite, periodo, contrato. Los cargos de renta se generan automáticamente el día 1 de cada mes por cada contrato vigente. El estatus (pendiente / pagado / parcial / vencido) se calcula de los pagos aplicados y la fecha límite; nunca se captura. Campo de notas internas ("le marqué el 5").
7. **Pago** — aplicado a uno o más cargos; fecha, monto, método, referencia, comprobante (archivo), cuenta destino (DISA / propietario), registrado por, estatus (vigente / cancelado con motivo). Acepta pagos parciales y adelantados.
8. **Gasto** — inmueble/unidad, fecha, concepto, monto, comprobante, pagado por (DISA → se descuenta en liquidación; propietario → informativo), autorizado por.
9. **Liquidación mensual** — por propietario y periodo. Cobrado − comisión − IVA de la comisión − gastos pagados por DISA = neto. "Cobrado" = suma de pagos vigentes del periodo aplicados a cargos tipo renta (los recargos entran sólo si así se pacta; ver §9). Comisión = % del propietario × cobrado. IVA = 16% de la comisión. Neto > 0: DISA paga al propietario; neto < 0: propietario debe a DISA. Estatus: borrador → cerrada → pagada. Al cerrar se genera el PDF del estado de cuenta y la liquidación queda inmutable; correcciones posteriores entran en la liquidación del mes siguiente como renglón de ajuste con nota. Registro de la transferencia (fecha, referencia, comprobante) al pasar a "pagada".
10. **Documento** — tipo (factura CFDI [PDF+XML], reporte, contrato, comprobante), archivo, ligado a propietario, unidad, pago o liquidación.
11. **Usuario** — rol: admin (Luis), equipo, propietario (ligado a un Propietario).
12. **Bitácora** — alta, cambio, cancelación o cierre en pagos, gastos, contratos y liquidaciones: qué, quién, cuándo, valores antes/después. Nadie la edita ni la borra desde la aplicación.

### Reglas de negocio

- El equipo nunca edita un estatus; registra pagos y el sistema calcula.
- Un pago no se borra; se cancela con motivo y queda en bitácora. Cancelar un pago después de cerrar una liquidación no altera la liquidación cerrada.
- Sólo el admin cierra liquidaciones y edita % de comisión y datos del propietario.
- Copropietarios de un inmueble ven una sola cuenta; el reparto entre ellos queda fuera de V1.
- El recargo por mora es un cargo tipo "recargo"; se muestra al propietario sólo si su opción "recargo visible" está activa. A quién pertenece el recargo se define en el contrato de administración (decisión pendiente, ver §9).

## 4. Aplicación del equipo (`app.ctdisa.com`)

Para personal no especializado: español, pocas opciones por pantalla, usable en celular.

1. **Tablero del día** — cargos vencidos (inquilino, unidad, días de atraso, monto), pagos registrados hoy, contratos que vencen en 60 días, liquidaciones del mes sin preparar. Números, sin gráficas de adorno.
2. **Cobranza** — lista de cargos del mes, filtros por inmueble, propietario, estatus y cobrador asignado (por defecto, lo del usuario). Botón "Registrar pago": monto, fecha, cuenta destino, referencia, foto del comprobante. Pagos parciales.
3. **Inmuebles y unidades** — ficha por inmueble: unidades, contrato vigente, inquilino, renta, estatus. Alta y edición.
4. **Contratos** — alta con PDF; lista de próximos a vencer; botón "Renovar" que crea el contrato nuevo copiando datos y aplicando el incremento, con estatus "pendiente de firma" visible hasta que se suba el PDF firmado.
5. **Gastos** — captura con comprobante y quién lo pagó; lista por inmueble y periodo.
6. **Liquidaciones** — por propietario y mes. El sistema arma el borrador con pagos y gastos del periodo; el equipo revisa; el admin cierra; se genera el PDF; se registra la transferencia y pasa a "pagada".
7. **Propietarios** — datos, modelo de dinero, comisión, opciones; usuarios del portal (invitación por correo).
8. **Facturación** — subir PDF y XML de la factura ligada al pago o a la liquidación. Sin timbrado en V1.

### Permisos

| Acción | Admin | Equipo | Propietario |
|---|---|---|---|
| Registrar pago / gasto / contrato | ✓ | ✓ | — |
| Cancelar pago (con motivo) | ✓ | ✓ | — |
| Borrar pago | — | — | — |
| Cerrar liquidación | ✓ | — | — |
| Editar % comisión y datos de propietario | ✓ | — | — |
| Ver todos los propietarios | ✓ | ✓ | — |
| Ver su propia cuenta (sólo lectura) | — | — | ✓ |
| Editar bitácora | — | — | — |

## 5. Portal del propietario (`clientes.ctdisa.com`)

Sólo lectura. Principio: en 10 segundos sabe si le pagaron.

1. **Acceso** — correo + enlace de acceso (expira en 15 min) o contraseña. Sólo ve su cuenta.
2. **Resumen** — mes en curso: renta esperada, cobrado, pendiente, vencido; lista de unidades con semáforo: pagado (fecha, monto) / pendiente (vence el día X) / vencido (N días).
3. **Estados de cuenta** — un renglón por mes: cobrado, comisión, gastos, neto, estatus (en preparación / cerrado / pagado el día X), descarga del PDF. Detalle con comprobantes de cada gasto. Sólo liquidaciones cerradas o pagadas; los borradores no se muestran.
4. **Contratos** — por unidad: inquilino (sólo nombre), vigencia, renta, depósito, próxima renovación, PDF.
5. **Documentos** — facturas de la comisión DISA y reportes históricos.
6. **Avisos por correo** — pago registrado, estado de cuenta listo, contrato por vencer (60 días). Configurables por propietario. Sin WhatsApp en V1.

No ve: notas internas, quién registró qué, otros propietarios, borradores, datos de contacto del inquilino.

Idioma: español por defecto, inglés como opción por propietario.

## 6. Arquitectura e infraestructura

- **Supabase** (Postgres + Auth + Storage), plan Pro ($25 USD/mes), región Estados Unidos. Todos los datos y archivos.
- **Vercel** — una sola aplicación Next.js con dos entradas (`app.` y `clientes.`) sobre el dominio ctdisa.com. Hobby para arrancar; Pro ($20 USD/mes) al pasar a producción con equipo.
- **Resend** — correos transaccionales (gratis hasta 3,000/mes).
- **Generación de PDF** del estado de cuenta en el servidor (plantilla HTML → PDF).
- **Tarea programada** diaria: generación de cargos el día 1, recálculo de "por vencer", envío de avisos.

### Seguridad

- Row Level Security en Postgres: cada fila lleva el `propietario_id`; un usuario con rol propietario no puede leer filas de otro propietario aunque manipule la aplicación. Las restricciones del equipo (no borrar pagos, no cerrar liquidaciones) también se aplican en base de datos.
- Equipo: correo + contraseña + código por correo desde dispositivo nuevo; sesiones de 12 horas; el admin puede cerrar sesiones remotas.
- Propietarios: enlace de acceso o contraseña.
- Bitácora inmutable (sin permisos de UPDATE/DELETE para ningún rol de aplicación).

### Respaldos

- Respaldo diario de Supabase Pro (7 días de retención).
- Exportación automática semanal (domingo) de base de datos y archivos al Google Drive de ctdisa, en formato estándar.

### Obligaciones fuera del sistema (Luis)

- Aviso de privacidad en el portal (datos de propietarios e inquilinos).
- El contrato de administración debe establecer que el estado de cuenta del portal es el oficial y el plazo de objeción (propuesta: 10 días hábiles tras el cierre).

## 7. Pruebas

- La lógica de dinero y de acceso se escribe con pruebas automáticas primero. Casos mínimos:
  - pago parcial → estatus "parcial" con saldo correcto;
  - pago adelantado de dos meses → dos cargos pagados;
  - cargo sin pago tras fecha límite → "vencido" con días de atraso;
  - gasto pagado por propietario → no se descuenta; gasto pagado por DISA → se descuenta;
  - comisión = % sobre cobrado; IVA sobre la comisión;
  - neto negativo en modelo cobra-propietario;
  - liquidación cerrada no cambia al cancelar un pago posterior; el ajuste aparece en el mes siguiente;
  - propietario A no lee filas de B (prueba contra la base de datos real);
  - equipo no puede borrar pagos ni cerrar liquidaciones;
  - bitácora no editable.
- Pruebas manuales con el equipo en la semana 2 (alta y cobranza) y la semana 5 (liquidación completa de un propietario real), media hora cada una.

## 8. Etapas y piloto

| # | Etapa | Entrega | Semanas |
|---|---|---|---|
| 1 | Base | BD, roles, login, bitácora, altas de propietarios/inmuebles/unidades/inquilinos/contratos | 1–2 |
| 2 | Cobranza | Cargos automáticos día 1, registro de pagos, tablero del día | 3 |
| 3 | Dinero | Gastos, liquidación (borrador → cierre → pagada), PDF | 4–5 |
| 4 | Portal | Acceso de propietarios, resumen, estados de cuenta, contratos, documentos, correos | 6 |
| 5 | Piloto | Un mes en paralelo con el método actual | 7–10 |

Piloto: entran Orizaba 407, Mary (Dr. Andrade 156) y Villalongin; Cuauhtémoc al arrancar su transición. Carga inicial: contratos vigentes y saldos a la fecha de arranque; sin historial anterior (reportes viejos como PDF en Documentos). Al cierre del mes se compara el estado de cuenta del sistema peso por peso contra el de Word; si cuadra en los tres, se abre el portal a los clientes; si no, se corrige y se repite un mes.

Mantenimiento: no se requiere personal de guardia (Vercel y Supabase operan la infraestructura); se recomienda un desarrollador por horas para cambios y correcciones que no se resuelvan con Claude.

## 9. Decisiones pendientes

1. Recargo por mora: visible al propietario sí/no y a quién pertenece (propuesta: visible como cargo separado sólo si está pactado; definirlo en el contrato de administración).
2. Plazo de objeción del estado de cuenta (propuesta: 10 días hábiles tras el cierre).
3. Si el portal servirá en el futuro para los inmuebles propios de DISA (no cambia el diseño).
4. Código por correo como segundo factor del equipo desde dispositivo nuevo (§6 Seguridad): diferido a fase 2; en V1 el equipo entra con enlace por correo (contraseña opcional).

## 10. Fuera de alcance en V1 (Fase 2, orden sugerido)

1. Tickets de mantenimiento con autorización del propietario desde el portal.
2. Recordatorios de cobranza con historial y paso a jurídico (día 30 / día 60).
3. Facturación CFDI desde el sistema.
4. Avisos por WhatsApp.
5. Lectura de estados de cuenta bancarios para conciliar pagos.
6. Reparto entre copropietarios.
7. Módulo de vacantes y promoción.
8. Acceso de inquilinos.
9. Segundo factor del equipo (código por correo desde dispositivo nuevo).
10. Subida directa a Storage para archivos de más de 4 MB.

## 11. Cambios durante la implementación

Reglas fijadas en la revisión final (migración `0009_ajustes_revision.sql`):

- **Renovación anticipada (F1).** Si la renovación se activa antes de la `fecha_fin` del contrato de origen, el origen queda `terminado` pero se sigue cobrando hasta su `fecha_fin` y se muestra vigente / por vencer por sus fechas; la renovación se cobra desde el primer mes que el origen ya no cubre. Nunca se cobran ambos el mismo mes.
- **Cierre de liquidaciones (F2).** No se cierra el mes en curso ni uno futuro; tampoco un mes si el propietario tiene uno anterior en borrador. La pantalla de liquidaciones y el tablero trabajan sobre el mes anterior.
- **Liquidación por cuenta destino (F3).** La comisión y el IVA se calculan sobre todo lo cobrado; el neto = cobrado en cuenta DISA − comisión − IVA − gastos pagados por DISA ± ajustes. El modelo del propietario queda como referencia y como cuenta por omisión al registrar pagos. Cancelación posterior al cierre: pago a cuenta DISA → ajuste −(monto − comisión − IVA); pago a cuenta del propietario → ajuste +(comisión + IVA).
- **Primer mes cobrado (F8).** Cada contrato tiene `cargos_desde` (por omisión su inicio); en la carga inicial, `primer_periodo_cargo` = primer mes que el sistema cobra (si la renta del mes de arranque ya se cobró fuera del sistema, el mes siguiente).
- **Incremento anual (F12).** La renta de cada mes = renta pactada × (1 + incremento)^(años cumplidos desde el inicio); la renovación parte de la renta del último año.
- **Segundo factor del equipo (F5).** Diferido a fase 2: en V1 todos entran con enlace por correo (vence en 15 min, sirve en otro dispositivo), contraseña opcional, sesiones de 12 h; el admin quita el acceso y cierra sesiones desactivando al usuario.
