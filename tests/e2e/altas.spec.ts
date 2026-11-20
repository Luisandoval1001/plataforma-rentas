import { expect, test, type Page } from '@playwright/test'
import { campo, fechaIso, fechaMx, loginComo, PDF_MINIMO, texto } from './helpers'

test.describe.configure({ mode: 'serial' })

let propietarioUrl = ''
let contratoUrl = ''

async function llenarContrato(page: Page, inquilino: { existente?: string; nuevo?: string }) {
  await page.goto('/app/contratos/nuevo')
  await campo(page, 'Propietario').selectOption({ label: 'Villalongin' })
  await campo(page, 'Inmueble').selectOption({ label: 'Orizaba 36' })
  await campo(page, 'Unidad').selectOption({ label: '407' })
  if (inquilino.existente) {
    await campo(page, 'Inquilino', { exact: true }).selectOption({ label: inquilino.existente })
  } else {
    await campo(page, 'Inquilino', { exact: true }).selectOption({ label: '— Inquilino nuevo —' })
    await campo(page, 'Nombre del inquilino').fill(inquilino.nuevo ?? '')
    await campo(page, 'Correo del inquilino').fill('juan@example.com')
  }
  await campo(page, 'Fecha de inicio').fill(fechaIso(0))
  await campo(page, 'Fecha de fin').fill(fechaIso(364))
  await campo(page, 'Renta mensual').fill('18,000')
  await campo(page, 'Día de pago').fill('5')
  await campo(page, 'Incremento anual (%)').fill('5')
  await page.getByRole('button', { name: 'Guardar contrato' }).click()
}

test('admin da de alta propietario, inmueble, unidad, inquilino y contrato vigente', async ({ page }) => {
  await loginComo(page, 'admin')

  // Propietario
  await page.goto('/app/propietarios/nuevo')
  await campo(page, 'Nombre o razón social').fill('Villalongin')
  await campo(page, 'Modelo de dinero').selectOption('cobra_disa')
  await campo(page, 'Comisión (%)').fill('15')
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page).toHaveURL(/\/app\/propietarios\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name: 'Villalongin' })).toBeVisible()
  await expect(texto(page, '15%')).toBeVisible()
  propietarioUrl = new URL(page.url()).pathname

  // Admin sí puede editar la comisión
  await page.getByRole('button', { name: 'Editar comisión' }).click()
  await campo(page, 'Comisión (%)').fill('12')
  await page.getByRole('button', { name: 'Guardar cambios' }).click()
  await expect(texto(page, '12%')).toBeVisible()

  // Inmueble
  await page.goto('/app/inmuebles/nuevo')
  await campo(page, 'Nombre').fill('Orizaba 36')
  await campo(page, 'Dirección').fill('Orizaba 36, Roma Norte')
  await campo(page, 'Tipo').selectOption('edificio')
  await campo(page, 'Propietario').selectOption({ label: 'Villalongin' })
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page).toHaveURL(/\/app\/inmuebles\/[0-9a-f-]{36}$/)
  await expect(page.getByRole('heading', { name: 'Orizaba 36' })).toBeVisible()

  // Cobrador asignado
  await campo(page, 'Cobrador asignado').selectOption({ label: 'Equipo' })
  await page.getByRole('button', { name: 'Guardar inmueble' }).click()
  await expect(texto(page, 'Guardado')).toBeVisible()

  // Unidad
  await campo(page, 'Nombre de la unidad').fill('407')
  await page.getByRole('button', { name: 'Agregar unidad' }).click()
  await expect(page.getByRole('cell', { name: '407', exact: true })).toBeVisible()

  // Contrato con inquilino nuevo
  await llenarContrato(page, { nuevo: 'Juan Pérez' })
  await expect(page).toHaveURL(/\/app\/contratos\/[0-9a-f-]{36}$/)
  contratoUrl = new URL(page.url()).pathname
  // Renta pactada y renta actual (primer año: iguales).
  await expect(texto(page, '$18,000.00')).toHaveCount(2)
  await expect(texto(page, 'Renta actual (con incremento anual)')).toBeVisible()

  await page.goto('/app/contratos')
  const fila = page.getByRole('row').filter({ hasText: 'Juan Pérez' })
  await expect(fila).toContainText('Orizaba 36 · 407')
  await expect(fila).toContainText('$18,000.00')
  await expect(fila).toContainText('vigente')
  await expect(fila).toContainText(fechaMx(0))
})

test('la unidad no admite un segundo contrato vigente', async ({ page }) => {
  await loginComo(page, 'admin')
  await llenarContrato(page, { existente: 'Juan Pérez' })
  await expect(texto(page, 'La unidad ya tiene un contrato vigente')).toBeVisible()
  await expect(page).toHaveURL(/\/app\/contratos\/nuevo$/)
})

test('equipo ve al propietario sin "Editar comisión" y no puede dar de alta propietarios', async ({ page }) => {
  await loginComo(page, 'equipo')
  await page.goto(propietarioUrl)
  await expect(page.getByRole('heading', { name: 'Villalongin' })).toBeVisible()
  await expect(texto(page, '12%')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Editar comisión' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Invitar' })).toHaveCount(0)

  await page.goto('/app/propietarios')
  await expect(page.getByRole('link', { name: 'Nuevo propietario' })).toHaveCount(0)
  // forbidden() dentro de Suspense: el estado HTTP ya se envió (200), pero se muestra la página 403.
  await page.goto('/app/propietarios/nuevo')
  await expect(page.getByRole('heading', { name: 'Sin permiso' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Guardar' })).toHaveCount(0)
})

test('equipo renueva el contrato y lo activa con el PDF firmado', async ({ page }) => {
  await loginComo(page, 'equipo')
  await page.goto(contratoUrl)
  await page.getByRole('button', { name: 'Renovar' }).click()

  // Ficha del contrato nuevo
  await expect(page).not.toHaveURL(contratoUrl)
  await expect(texto(page, `pendiente de firma desde ${fechaMx(0)}`, { exact: false })).toBeVisible()
  await expect(texto(page, '$18,900.00')).toHaveCount(2) // renta pactada y renta actual
  await expect(texto(page, fechaMx(365))).toHaveCount(2) // inicio y "Se cobra desde"

  await page.goto('/app/contratos')
  await expect(
    page.getByRole('row').filter({ hasText: `pendiente de firma desde ${fechaMx(0)}` }),
  ).toHaveCount(1)

  // Activar con el PDF firmado: el nuevo queda vigente y el original terminado
  await page.getByRole('row').filter({ hasText: 'pendiente de firma' }).getByRole('link').first().click()
  await campo(page, 'Contrato firmado (PDF)').setInputFiles({
    name: 'firmado.pdf',
    mimeType: 'application/pdf',
    buffer: PDF_MINIMO,
  })
  await page.getByRole('button', { name: 'Activar contrato' }).click()
  await expect(texto(page, 'pendiente de firma desde')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Ver PDF' })).toBeVisible()

  // El original queda terminado, pero como la renovación se activó antes de su fecha de fin se
  // sigue cobrando (y mostrando como vigente) hasta esa fecha; ya no ofrece Renovar ni Terminar.
  await page.goto(contratoUrl)
  await expect(page.getByTestId('estatus').filter({ visible: true })).toHaveText(/vigente|por vencer/)
  await expect(page.getByRole('link', { name: 'Ver renovación' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Terminar contrato' })).toHaveCount(0)
})
