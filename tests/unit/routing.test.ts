import { describe, expect, it } from 'vitest'
import { resolverRewrite } from '@/lib/routing'

describe('resolverRewrite', () => {
  it('clientes.* reescribe a /clientes', () => {
    expect(resolverRewrite('clientes.ctdisa.com', '/')).toBe('/clientes')
    expect(resolverRewrite('clientes.ctdisa.com', '/estado-cuenta')).toBe('/clientes/estado-cuenta')
  })

  it('app.* reescribe a /app', () => {
    expect(resolverRewrite('app.ctdisa.com', '/cobranza')).toBe('/app/cobranza')
    expect(resolverRewrite('APP.ctdisa.com:443', '/')).toBe('/app')
  })

  it('localhost y otros hosts no se reescriben', () => {
    expect(resolverRewrite('localhost:3000', '/app')).toBeNull()
    expect(resolverRewrite('ctdisa.com', '/')).toBeNull()
  })

  it('no reescribe api, login ni rutas ya prefijadas', () => {
    expect(resolverRewrite('clientes.ctdisa.com', '/api/archivos/a.pdf')).toBeNull()
    expect(resolverRewrite('clientes.ctdisa.com', '/login')).toBeNull()
    expect(resolverRewrite('clientes.ctdisa.com', '/auth/callback')).toBeNull()
    expect(resolverRewrite('app.ctdisa.com', '/dev-login')).toBeNull()
    expect(resolverRewrite('app.ctdisa.com', '/app/cobranza')).toBeNull()
    expect(resolverRewrite('clientes.ctdisa.com', '/clientes')).toBeNull()
  })
})
