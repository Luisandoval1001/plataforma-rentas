import { defineConfig } from 'vitest/config'
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

// Las pruebas de BD comparten una sola base (rentas_test): se corren en serie.
config({ path: '.env.test', quiet: true })

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
})
