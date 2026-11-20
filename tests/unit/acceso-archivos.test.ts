import { describe, expect, it } from 'vitest'
import { puedeLeerArchivo } from '@/lib/storage/acceso'
import type { Session } from '@/lib/auth/types'

const A = '00000000-0000-0000-0000-0000000000a1'
const prop: Session = { usuarioId: 'u', email: 'p@x', rol: 'propietario', propietarioIds: [A] }
const equipo: Session = { usuarioId: 'e', email: 'e@x', rol: 'equipo', propietarioIds: [] }

describe('puedeLeerArchivo', () => {
  it('propietario sólo lee bajo propietarios/<suyo>/', () => {
    expect(puedeLeerArchivo(prop, `propietarios/${A}/edo.pdf`)).toBe(true)
    expect(puedeLeerArchivo(prop, `propietarios/otro/edo.pdf`)).toBe(false)
    expect(puedeLeerArchivo(prop, `propietarios/${A}`)).toBe(false)
    expect(puedeLeerArchivo(prop, `propietarios/${A}/../otro/x.pdf`)).toBe(false)
    expect(puedeLeerArchivo(prop, `contratos/x.pdf`)).toBe(false)
  })

  it('equipo y admin leen cualquier ruta', () => {
    expect(puedeLeerArchivo(equipo, 'contratos/x.pdf')).toBe(true)
  })
})
