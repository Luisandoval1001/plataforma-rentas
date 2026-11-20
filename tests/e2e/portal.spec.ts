import { expect, test, type Page } from '@playwright/test'
import postgres from 'postgres'
import { PROPIETARIOS } from '../db/harness'
import { dinero } from '../../src/lib/formato'
import { putFile } from '../../src/lib/storage/local'
import { loginComo, PDF_MINIMO, texto } from './helpers'

test.describe.configure({ mode: 'serial' })

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const PDF_A = `propietarios/${PROPIETARIOS.A}/liquidaciones/portal-e2e.pdf`

let periodoCerrada = '' // "Julio 2026"
let periodoBorrador = ''

// Cliente propio: otras specs del mismo worker cierran el sqlAdmin compartido del harness.
const sqlAdmin = postgres(process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/rentas_test', {
  max: 1,
  onnotice: () => {},
})

const textoPeriodo = (p: string) => `${MESES[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}`

// A: P-1 con la renta del mes pagada hoy, P-2 con la renta del mes vencida hace 4 días, una
// liquidación cerrada (con PDF real en el almacenamiento local) y otra en borrador, y un documento
// visible. B: una unidad con su cargo del mes.
test.beforeAll(async () => {
  await sqlAdmin`update propietarios set idioma = 'es' where id = ${PROPIETARIOS.A}`
  const [inm] = await sqlAdmin`insert into inmuebles (propietario_id, nombre, tipo)
    values (${PROPIETARIOS.A}, 'Torre Portal', 'edificio') returning id`
  const contrato = async (inmuebleId: string, unidad: string, inquilino: string, renta: number) => {
    const [u] = await sqlAdmin`insert into unidades (inmueble_id, nombre) values (${inmuebleId}, ${unidad}) returning id`
    const [i] = await sqlAdmin`insert into inquilinos (nombre) values (${inquilino}) returning id`
    const [c] = await sqlAdmin`insert into contratos (unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago, deposito)
      values (${u.id}, ${i.id}, current_date - 100, current_date + 265, ${renta}, 5, ${renta}) returning id`
    return c.id as string
  }
  const c1 = await contrato(inm.id, 'P-1', 'Inquilina Uno', 9000)
  const c2 = await contrato(inm.id, 'P-2', 'Inquilino Dos', 7000)
  const [cargo1] = await sqlAdmin`insert into cargos (contrato_id, tipo, periodo, monto, fecha_limite)
    values (${c1}, 'renta', date_trunc('month', current_date)::date, 9000, current_date + 2) returning id`
  await sqlAdmin`insert into cargos (contrato_id, tipo, periodo, monto, fecha_limite)
    values (${c2}, 'renta', date_trunc('month', current_date)::date, 7000, current_date - 4)`
  await sqlAdmin.begin(async (tx) => {
    await tx`set local role app_server`
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: '00000000-0000-0000-0000-00000000000b', role: 'authenticated' })}, true)`
    await tx`select registrar_pago(${[cargo1.id]}::uuid[], 9000, current_date, 'transferencia', 'REF-PORTAL', 'disa', null)`
  })

  const [inmB] = await sqlAdmin`insert into inmuebles (propietario_id, nombre, tipo)
    values (${PROPIETARIOS.B}, 'Casa B Portal', 'casa') returning id`
  const cB = await contrato(inmB.id, 'B-9', 'Inquilino B', 5000)
  await sqlAdmin`insert into cargos (contrato_id, tipo, periodo, monto, fecha_limite)
    values (${cB}, 'renta', date_trunc('month', current_date)::date, 5000, current_date - 1)`

  await putFile(PDF_A, PDF_MINIMO, 'application/pdf')
  const [b] = await sqlAdmin`insert into liquidaciones (propietario_id, periodo, modelo, comision_pct, cobrado, neto)
    values (${PROPIETARIOS.A}, date_trunc('month', current_date - interval '5 month')::date, 'cobra_disa', 15, 1, 1)
    returning to_char(periodo, 'YYYY-MM') as p`
  periodoBorrador = textoPeriodo(b.p)
  const [l] = await sqlAdmin`insert into liquidaciones (propietario_id, periodo, modelo, comision_pct,
      cobrado, comision, iva, gastos_disa, neto, pdf_path)
    values (${PROPIETARIOS.A}, date_trunc('month', current_date - interval '4 month')::date, 'cobra_disa', 15,
      20000, 3000, 480, 1500, 15020, ${PDF_A})
    returning id, to_char(periodo, 'YYYY-MM') as p`
  periodoCerrada = textoPeriodo(l.p)
  await sqlAdmin`insert into liquidacion_lineas (liquidacion_id, tipo, descripcion, monto)
    values (${l.id}, 'cobro', 'Renta P-1', 20000), (${l.id}, 'gasto_disa', 'Jardinería', 1500)`
  await sqlAdmin`update liquidaciones set estatus = 'cerrada', cerrada_at = now() where id = ${l.id}`
  await sqlAdmin`insert into documentos (propietario_id, tipo, nombre, path, liquidacion_id)
    values (${PROPIETARIOS.A}, 'reporte', 'Reporte portal e2e', ${PDF_A}, ${l.id})`
})
test.afterAll(async () => {
  await sqlAdmin`update propietarios set idioma = 'es' where id = ${PROPIETARIOS.A}`
  await sqlAdmin.end({ timeout: 5 })
})

/** Totales del mes de A según las tablas (otras specs también le crean cargos). */
async function totalesA() {
  const [r] = await sqlAdmin`
    with c as (
      select cg.monto, cg.fecha_limite,
             coalesce((select sum(pa.monto) from pago_aplicaciones pa join pagos pg on pg.id = pa.pago_id
                       where pa.cargo_id = cg.id and not pg.cancelado), 0) as pagado
      from cargos cg
      where cg.propietario_id = ${PROPIETARIOS.A} and cg.tipo <> 'recargo'
        and cg.periodo = date_trunc('month', current_date)::date)
    select coalesce(sum(monto), 0)::float8 as esperado, coalesce(sum(pagado), 0)::float8 as cobrado,
           coalesce(sum(monto - pagado) filter (where monto > pagado and fecha_limite >= current_date), 0)::float8 as pendiente,
           coalesce(sum(monto - pagado) filter (where monto > pagado and fecha_limite < current_date), 0)::float8 as vencido
    from c`
  return r as { esperado: number; cobrado: number; pendiente: number; vencido: number }
}

const unidad = (page: Page, nombre: string) => page.getByTestId('unidad').filter({ visible: true, hasText: nombre })

test('resumen: unidades y totales de A, nada de B', async ({ page }) => {
  await loginComo(page, 'propa')
  await expect(page).toHaveURL(/\/clientes$/)
  await expect(page.getByRole('heading', { name: 'Resumen del mes' })).toBeVisible()

  const t = await totalesA()
  for (const k of ['esperado', 'cobrado', 'pendiente', 'vencido'] as const) {
    await expect(page.getByTestId(`total-${k}`).filter({ visible: true })).toHaveText(dinero(t[k]))
  }

  await expect(unidad(page, 'P-1')).toContainText('Pagado')
  await expect(unidad(page, 'P-1')).toContainText('$9,000.00')
  await expect(unidad(page, 'P-1')).toContainText('Inquilina Uno')
  await expect(unidad(page, 'P-2')).toContainText('Vencido')
  await expect(unidad(page, 'P-2')).toContainText('4 días de atraso')
  await expect(unidad(page, 'P-2')).toContainText('$7,000.00')
  await expect(texto(page, 'B-9')).toHaveCount(0)
  await expect(texto(page, 'Casa B Portal')).toHaveCount(0)
})

test('estados de cuenta: sólo la cerrada, con PDF descargable y detalle', async ({ page }) => {
  await loginComo(page, 'propa')
  await page.getByRole('link', { name: 'Estados de cuenta' }).click()
  await expect(page.getByRole('heading', { name: 'Estados de cuenta' })).toBeVisible()
  const fila = page.getByTestId('liquidacion').filter({ visible: true, hasText: periodoCerrada })
  await expect(fila).toContainText('$15,020.00')
  await expect(fila).toContainText('Cerrado')
  await expect(texto(page, periodoBorrador)).toHaveCount(0)

  const href = await fila.getByRole('link', { name: 'Descargar PDF' }).getAttribute('href')
  const res = await page.request.get(href!)
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toBe('application/pdf')

  await fila.getByRole('link', { name: periodoCerrada }).click()
  await expect(page.getByRole('heading', { name: `Estado de cuenta · ${periodoCerrada}` })).toBeVisible()
  await expect(page.getByTestId('neto').filter({ visible: true })).toHaveText('$15,020.00')
  await expect(page.getByRole('row').filter({ hasText: 'Jardinería' })).toContainText('$1,500.00')
  await expect(page.getByRole('link', { name: 'Reporte portal e2e' })).toBeVisible()
})

test('contratos y documentos de A', async ({ page }) => {
  await loginComo(page, 'propa')
  await page.goto('/clientes/contratos')
  await expect(page.getByTestId('contrato').filter({ visible: true, hasText: 'P-2' })).toContainText('Inquilino Dos')
  await expect(texto(page, 'Inquilino B')).toHaveCount(0)
  await page.goto('/clientes/documentos')
  await expect(page.getByRole('link', { name: 'Reporte portal e2e' })).toBeVisible()
})

test('propietario no entra a /app; equipo no entra a /clientes', async ({ page }) => {
  await loginComo(page, 'propa')
  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'Sin permiso' })).toBeVisible()
  await loginComo(page, 'equipo')
  await page.goto('/clientes')
  await expect(page.getByRole('heading', { name: 'Sin permiso' })).toBeVisible()
})

test('archivos de B: 403 para propA', async ({ page }) => {
  await loginComo(page, 'propa')
  const res = await page.request.get(`/api/archivos/propietarios/${PROPIETARIOS.B}/liquidaciones/x.pdf`)
  expect(res.status()).toBe(403)
})

test('propietario con idioma inglés ve el portal en inglés', async ({ page }) => {
  await loginComo(page, 'propa')
  await sqlAdmin`update propietarios set idioma = 'en' where id = ${PROPIETARIOS.A}`
  await page.reload()
  await expect(page.getByRole('heading', { name: 'This month' })).toBeVisible()
  await expect(unidad(page, 'P-2')).toContainText('Overdue')
  await expect(unidad(page, 'P-2')).toContainText('4 days overdue')
  await expect(page.getByRole('link', { name: 'Account statements' })).toBeVisible()
  await sqlAdmin`update propietarios set idioma = 'es' where id = ${PROPIETARIOS.A}`
})

test('en teléfono no hay desplazamiento horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await loginComo(page, 'propa')
  for (const ruta of ['/clientes', '/clientes/estados-de-cuenta', '/clientes/contratos', '/clientes/documentos']) {
    await page.goto(ruta)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  }
})

test('cerrar sesión lleva al login (con enlace a /dev-login en modo local)', async ({ page }) => {
  await loginComo(page, 'propa')
  await page.getByRole('button', { name: 'Cerrar sesión' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('link', { name: /usuario de prueba/ })).toBeVisible()
  await page.goto('/clientes')
  await expect(page).toHaveURL(/\/login$/)
})
