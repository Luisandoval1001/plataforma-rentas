import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import postgres from 'postgres'
import { IDS, PROPIETARIOS } from '../db/harness'
import { campo, loginComo } from './helpers'
import { CORREOS_E2E } from './seed'

test.describe.configure({ mode: 'serial' })

// Periodo liquidado: el mes anterior (lo de otras pruebas, con fecha de hoy, no entra).
let periodo = '' // YYYY-MM
let mesTexto = '' // "octubre de 2026"
let detalleUrl = ''

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

// Cliente propio: otra spec del mismo worker cierra el sqlAdmin compartido del harness en su afterAll.
const sqlAdmin = postgres(process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/rentas_test', {
  max: 1,
  onnotice: () => {},
})

// Propietario A (cobra_disa 15%): renta de 10,000 del periodo pagada el día 3 del periodo.
test.beforeAll(async () => {
  const [{ p }] = await sqlAdmin`select to_char(current_date - interval '1 month', 'YYYY-MM') as p`
  periodo = p
  mesTexto = `${MESES[Number(p.slice(5)) - 1]} de ${p.slice(0, 4)}`
  await sqlAdmin`update propietarios set contacto_email = 'dueno@a.mx', avisos_estado_cuenta = true,
    modelo = 'cobra_disa', comision_pct = 15 where id = ${PROPIETARIOS.A}`
  const [inm] = await sqlAdmin`insert into inmuebles (propietario_id, nombre, tipo)
    values (${PROPIETARIOS.A}, 'Torre Liquidaciones', 'edificio') returning id`
  const [uni] = await sqlAdmin`insert into unidades (inmueble_id, nombre) values (${inm.id}, 'L-1') returning id`
  const [inq] = await sqlAdmin`insert into inquilinos (nombre) values ('Inquilino L') returning id`
  const [c] = await sqlAdmin`insert into contratos (unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago)
    values (${uni.id}, ${inq.id}, current_date - 200, current_date + 165, 10000, 5) returning id`
  const inicio = `${periodo}-01`
  const [cargo] = await sqlAdmin`insert into cargos (contrato_id, tipo, periodo, monto, fecha_limite)
    values (${c.id}, 'renta', ${inicio}, 10000, ${inicio}::date + 4) returning id`
  const claims = JSON.stringify({ sub: IDS.equipo, role: 'authenticated' })
  await sqlAdmin.begin(async (tx) => {
    await tx`set local role app_server`
    await tx`select set_config('request.jwt.claims', ${claims}, true)`
    await tx`select registrar_pago(${[cargo.id]}::uuid[], 10000, ${inicio}::date + 2,
      'transferencia', 'REF-LIQ', 'disa', null)`
  })
})
test.afterAll(async () => {
  await sqlAdmin.end({ timeout: 5 })
})

// Next deja ocultas en el DOM las páginas visitadas: sólo la insignia visible.
const estatus = (page: Page) => page.getByTestId('estatus').filter({ visible: true })

const filaA = (page: Page) =>
  page.getByRole('row').filter({ has: page.getByRole('cell', { name: 'A', exact: true }) })

test('equipo registra un gasto DISA de 1,000', async ({ page }) => {
  await loginComo(page, 'equipo')
  await page.goto('/app/gastos')
  await page.getByRole('link', { name: 'Nuevo gasto' }).click()
  await expect(page.getByRole('heading', { name: 'Nuevo gasto' })).toBeVisible()
  await campo(page, 'Inmueble').selectOption({ label: 'Torre Liquidaciones' })
  await campo(page, 'Unidad').selectOption({ label: 'L-1' })
  await campo(page, 'Fecha').fill(`${periodo}-10`)
  await campo(page, 'Concepto').fill('Impermeabilización')
  await campo(page, 'Monto').fill('1,000')
  await campo(page, 'Pagado por').selectOption({ label: 'DISA' })
  await campo(page, 'Autorizado por').fill('Luis')
  await page.getByRole('button', { name: 'Guardar gasto' }).click()
  await expect(page).toHaveURL(/\/app\/gastos$/)
  const fila = page.getByRole('row').filter({ hasText: 'Impermeabilización' })
  await expect(fila).toContainText('$1,000.00')
  await expect(fila).toContainText('DISA')
})

test('equipo prepara la liquidación de A; no puede cerrarla', async ({ page }) => {
  await loginComo(page, 'equipo')
  await page.goto(`/app/liquidaciones?periodo=${periodo}`)
  await expect(filaA(page).getByTestId('estatus')).toHaveText('sin preparar')
  await filaA(page).getByRole('button', { name: 'Preparar' }).click()
  await expect(page).toHaveURL(/\/app\/liquidaciones\/[0-9a-f-]{36}$/)
  detalleUrl = new URL(page.url()).pathname

  const totales = page.getByRole('region', { name: 'Totales' })
  await expect(totales).toContainText('$10,000.00')
  await expect(totales).toContainText('$1,500.00')
  await expect(totales).toContainText('$240.00')
  await expect(totales).toContainText('$1,000.00')
  await expect(totales.getByTestId('neto')).toHaveText('$7,260.00')
  await expect(estatus(page)).toHaveText('borrador')
  await expect(page.getByRole('button', { name: 'Cerrar liquidación' })).toBeDisabled()
})

test('admin cierra: estatus cerrada, PDF descargable y aviso por correo', async ({ page }) => {
  await loginComo(page, 'admin')
  await page.goto(detalleUrl)
  page.once('dialog', (d) => d.accept())
  await page.getByRole('button', { name: 'Cerrar liquidación' }).click()
  await expect(estatus(page)).toHaveText('cerrada')

  const enlace = page.getByRole('link', { name: 'Ver PDF' })
  await expect(enlace).toBeVisible()
  const res = await page.request.get((await enlace.getAttribute('href'))!)
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toBe('application/pdf')
  expect((await res.body()).subarray(0, 4).toString()).toBe('%PDF')

  await expect(page.getByRole('region', { name: 'Documentos' })).toContainText(`Estado de cuenta ${periodo}`)

  const archivos = await readdir(CORREOS_E2E)
  const asuntos = await Promise.all(
    archivos.map(async (a) => JSON.parse(await readFile(join(CORREOS_E2E, a), 'utf8')).subject as string),
  )
  expect(asuntos).toContain(`Tu estado de cuenta de ${mesTexto} está listo`)
})

test('equipo registra el pago de la liquidación: pagada', async ({ page }) => {
  await loginComo(page, 'equipo')
  await page.goto(detalleUrl)
  const pago = page.getByRole('region', { name: 'Registrar pago' })
  await pago.getByLabel('Referencia').fill('TRF-LIQ-1')
  await pago.getByRole('button', { name: 'Registrar pago' }).click()
  await expect(estatus(page)).toHaveText('pagada')
  await expect(page.getByText('TRF-LIQ-1')).toBeVisible()

  await page.goto(`/app/liquidaciones?periodo=${periodo}`)
  await expect(filaA(page).getByTestId('estatus')).toHaveText('pagada')
})
