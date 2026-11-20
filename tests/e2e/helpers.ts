import { expect, type Page } from '@playwright/test'

// Next conserva las páginas visitadas ocultas (Activity) en el DOM: getByLabel/getByText
// también las encuentran, así que se filtran a lo visible. getByRole ya las excluye.
export const campo = (page: Page, etiqueta: string, opciones?: { exact?: boolean }) =>
  page.getByLabel(etiqueta, opciones).filter({ visible: true })

export const texto = (page: Page, t: string, opciones?: { exact?: boolean }) =>
  page.getByText(t, opciones).filter({ visible: true })

const CORREOS = {
  admin: 'admin@local',
  equipo: 'equipo@local',
  propa: 'propa@local',
  propb: 'propb@local',
} as const

/** Entra con /dev-login (AUTH_PROVIDER=local) como el usuario semilla indicado. */
export async function loginComo(page: Page, quien: keyof typeof CORREOS) {
  await page.goto('/dev-login')
  await page.getByRole('button', { name: CORREOS[quien] }).click()
  await expect(page).not.toHaveURL(/dev-login/)
}

/** Fecha local en dd/mm/yyyy, con desplazamiento opcional en días. */
export function fechaMx(desplazamientoDias = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + desplazamientoDias)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

/** Fecha local en yyyy-mm-dd (valor de <input type="date">). */
export function fechaIso(desplazamientoDias = 0): string {
  const [dd, mm, yyyy] = fechaMx(desplazamientoDias).split('/')
  return `${yyyy}-${mm}-${dd}`
}

/** PDF mínimo válido para subir como contrato firmado. */
export const PDF_MINIMO = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)
