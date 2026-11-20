import { afterEach, describe, expect, it, vi } from 'vitest'
import { proveedorAuth } from '@/lib/auth/proveedor'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('proveedorAuth', () => {
  it('acepta local y supabase', () => {
    vi.stubEnv('AUTH_PROVIDER', 'local')
    expect(proveedorAuth()).toBe('local')
    vi.stubEnv('AUTH_PROVIDER', 'supabase')
    expect(proveedorAuth()).toBe('supabase')
  })

  it('falla si falta o es desconocido', () => {
    vi.stubEnv('AUTH_PROVIDER', 'otro')
    expect(() => proveedorAuth()).toThrow('AUTH_PROVIDER inválido')
    vi.stubEnv('AUTH_PROVIDER', '')
    expect(() => proveedorAuth()).toThrow('AUTH_PROVIDER inválido')
  })

  it('local nunca corre en producción', () => {
    vi.stubEnv('AUTH_PROVIDER', 'local')
    vi.stubEnv('NODE_ENV', 'production')
    expect(() => proveedorAuth()).toThrow(/producción/)
  })

  it('local en producción sólo con MODO_DEMO=1 (demo con datos ficticios)', () => {
    vi.stubEnv('AUTH_PROVIDER', 'local')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('MODO_DEMO', '1')
    expect(proveedorAuth()).toBe('local')
    vi.stubEnv('MODO_DEMO', 'true')
    expect(() => proveedorAuth()).toThrow(/producción/)
  })
})
