import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { closeDb, IDS, PROPIETARIOS, sqlAdmin } from '../db/harness'
import { campo, loginComo } from './helpers'
import { CORREOS_E2E } from './seed'

test.describe.configure({ mode: 'serial' })

// Propietario A (semilla) con avisos de pago: inmueble, unidad, contrato vigente y dos cargos de
// renta: el del mes en curso (pendiente, vence en 10 días) y el del mes anterior (vencido hace 10).
test.beforeAll(async () => {
  await sqlAdmin`update propietarios set contacto_email = 'dueno@a.mx', avisos_pago = true where id = ${PROPIETARIOS.A}`
  const [inm] = await sqlAdmin`insert into inmuebles (propietario_id, nombre, tipo, cobrador_id)
    values (${PROPIETARIOS.A}, 'Campana 21', 'edificio', ${IDS.equipo}) returning id`
  const [uni] = await sqlAdmin`insert into unidades (inmueble_id, nombre) values (${inm.id}, 'Depto 3B') returning id`
  const [inq] = await sqlAdmin`insert into inquilinos (nombre) values ('María López') returning id`
  const [c] = await sqlAdmin`insert into contratos (unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago)
    values (${uni.id}, ${inq.id}, current_date - 200, current_date + 165, 10000, 5) returning id`
  await sqlAdmin`insert into cargos (contrato_id, tipo, periodo, monto, fecha_limite) values
    (${c.id}, 'renta', date_trunc('month', current_date)::date, 10000, current_date + 10),
    (${c.id}, 'renta', (date_trunc('month', current_date) - interval '1 month')::date, 10000, current_date - 10)`
})
test.afterAll(async () => {
  await closeDb()
})

const fila = (page: Page) => page.getByRole('row').filter({ hasText: 'Depto 3B' })

async function registrarPago(page: Page, monto: string, referencia: string) {
  await fila(page).getByRole('button', { name: 'Registrar pago' }).click()
  const dialogo = page.getByRole('dialog', { name: 'Registrar pago' })
  await expect(dialogo).toBeVisible()
  await dialogo.getByLabel('Monto').fill(monto)
  await dialogo.getByLabel('Referencia').fill(referencia)
  await dialogo.getByRole('button', { name: 'Guardar pago' }).click()
  return dialogo
}

test('tablero: un cargo vencido con sus días de atraso', async ({ page }) => {
  await loginComo(page, 'equipo')
  await page.goto('/app')
  const vencidos = page.getByRole('region', { name: /Vencidos/ })
  await expect(vencidos.getByTestId('conteo')).toHaveText('1')
  const renglon = vencidos.getByRole('listitem').filter({ hasText: 'Depto 3B' })
  await expect(renglon).toContainText('Campana 21')
  await expect(renglon).toContainText('10 días')
  await expect(renglon).toContainText('$10,000.00')
})

test('cobranza: pago parcial, referencia repetida, sobrepago y cancelación', async ({ page }) => {
  await loginComo(page, 'equipo')
  await page.goto('/app/cobranza')
  await expect(fila(page)).toHaveCount(1)
  await expect(fila(page).getByTestId('estatus')).toHaveText('pendiente')

  // Pago parcial
  let dialogo = await registrarPago(page, '4,000', 'REF-1')
  await expect(dialogo).toBeHidden()
  await expect(fila(page).getByTestId('estatus')).toHaveText('parcial')
  await expect(fila(page)).toContainText('$6,000.00')

  // Misma referencia
  dialogo = await registrarPago(page, '1,000', 'REF-1')
  await expect(dialogo.getByText('Ya existe un pago con esa referencia')).toBeVisible()

  // Sobrepago (saldo 6,000)
  await dialogo.getByLabel('Monto').fill('7,000')
  await dialogo.getByLabel('Referencia').fill('REF-2')
  await dialogo.getByRole('button', { name: 'Guardar pago' }).click()
  await expect(dialogo.getByText('El monto excede el saldo de los cargos seleccionados')).toBeVisible()
  await dialogo.getByRole('button', { name: 'Cerrar' }).click()
  await expect(dialogo).toBeHidden()

  // Cancelar el pago con motivo
  await fila(page).getByText('Pagos (1)').click()
  page.once('dialog', (d) => d.accept('Error de captura'))
  await fila(page).getByRole('button', { name: 'Cancelar pago' }).click()
  await expect(fila(page).getByTestId('estatus')).toHaveText('pendiente')
  await expect(fila(page)).toContainText('Error de captura')
})

test('el aviso de pago al propietario incluye la unidad en el asunto', async () => {
  const archivos = await readdir(CORREOS_E2E)
  const asuntos = await Promise.all(
    archivos.map(async (a) => JSON.parse(await readFile(join(CORREOS_E2E, a), 'utf8')).subject as string),
  )
  expect(asuntos).toContain('Se registró un pago en Campana 21 Depto 3B')
})

test('notas del cargo editables en línea', async ({ page }) => {
  await loginComo(page, 'equipo')
  await page.goto('/app/cobranza')
  const nota = fila(page).getByLabel('Notas')
  await nota.fill('Paga el viernes')
  await nota.press('Enter')
  await expect(fila(page).getByText('Guardado')).toBeVisible()
  await page.reload()
  await expect(fila(page).getByLabel('Notas')).toHaveValue('Paga el viernes')
  await expect(campo(page, 'Cobrador')).toBeVisible()
})
