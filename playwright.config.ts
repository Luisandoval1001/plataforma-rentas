import { defineConfig, devices } from '@playwright/test'
import { config } from 'dotenv'
import { CORREOS_E2E } from './tests/e2e/seed'

// Las mismas variables que vitest: BD rentas_test y proveedores locales, pasadas explícitamente.
const { parsed: envTest = {} } = config({ path: '.env.test', quiet: true })

// Puerto propio y nunca reutilizado: un `next dev` ajeno (en 3000, con otra BD) no recibe datos de prueba.
const PUERTO = 3100

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/seed.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PUERTO}`,
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next dev -p ${PUERTO}`,
    url: `http://localhost:${PUERTO}/dev-login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...envTest, EMAIL_LOCAL_DIR: CORREOS_E2E },
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
