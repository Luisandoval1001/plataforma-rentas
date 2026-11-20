import { describe, expect, it } from 'vitest'
import { crearCookieLocal, leerSesionLocal, SESION_COOKIE } from '@/lib/auth/providers/local'

const ID = '00000000-0000-0000-0000-00000000000c'

function jar(value?: string) {
  return { get: (name: string) => (name === SESION_COOKIE && value !== undefined ? { value } : undefined) }
}

describe('cookie de sesión local', () => {
  it('ida y vuelta devuelve el usuarioId', () => {
    const c = crearCookieLocal(ID)
    expect(c.name).toBe('sesion')
    expect(c.options).toMatchObject({ httpOnly: true, sameSite: 'lax', maxAge: 12 * 60 * 60, path: '/' })
    expect(leerSesionLocal(jar(c.value))).toBe(ID)
  })

  it('firma alterada o cookie malformada → null', () => {
    const { value } = crearCookieLocal(ID)
    const [payload, firma] = value.split('.')
    const otra = Buffer.from('00000000-0000-0000-0000-00000000000a').toString('base64url')
    expect(leerSesionLocal(jar(`${otra}.${firma}`))).toBeNull()
    expect(leerSesionLocal(jar(`${payload}.${firma.slice(0, -2)}AA`))).toBeNull()
    expect(leerSesionLocal(jar(`${payload}`))).toBeNull()
    expect(leerSesionLocal(jar(''))).toBeNull()
    expect(leerSesionLocal(jar())).toBeNull()
  })
})
