import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { closeDb, resetDb, seedUsuarios } from '../db/harness'

/** Carpeta de correos del servidor E2E (EMAIL_LOCAL_DIR en playwright.config.ts). */
export const CORREOS_E2E = join(process.cwd(), 'tmp', 'e2e-emails')

/** globalSetup de Playwright: BD limpia con los usuarios semilla (admin, equipo, propA, propB) y sin correos previos. */
export default async function seed() {
  await rm(CORREOS_E2E, { recursive: true, force: true })
  await resetDb()
  await seedUsuarios()
  await closeDb()
}
