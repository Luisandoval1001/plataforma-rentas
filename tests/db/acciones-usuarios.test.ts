import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Resultado } from '@/lib/acciones'
import { closeDb, resetDb, seedUsuarios, sqlAdmin } from './harness'

const frasco = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (frasco.has(n) ? { value: frasco.get(n)! } : undefined) }),
}))
process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = 'true'

// Supabase Auth (service role) simulado: se verifica que se bloquee/desbloquee al usuario.
const supa = vi.hoisted(() => ({ updateUserById: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { admin: { updateUserById: supa.updateUserById } } }),
}))

const { crearCookieLocal } = await import('@/lib/auth/providers/local')
const { closeSql, withSession } = await import('@/lib/db')
const { cargarSesion } = await import('@/lib/auth/cargar')
const usr = await import('@/app/app/_actions/usuarios')
const { cambiarActivoUsuario } = await import('@/lib/auth/usuarios')
const { listarUsuariosEquipo } = await import('@/lib/queries/usuarios')

const SISTEMA = '00000000-0000-0000-0000-000000000001'
const FORBIDDEN = /NEXT_HTTP_ERROR_FALLBACK;403/
let ids: Awaited<ReturnType<typeof seedUsuarios>>

function como(usuarioId: string) {
  const c = crearCookieLocal(usuarioId)
  frasco.set(c.name, c.value)
}

function okId(r: Resultado): string {
  if (!r.ok) throw new Error(`Se esperaba ok: ${JSON.stringify(r.errores)}`)
  return r.id
}

const activo = async (id: string) => (await sqlAdmin`select activo from usuarios where id = ${id}`)[0].activo as boolean

beforeAll(async () => {
  await resetDb()
})
beforeEach(async () => {
  vi.unstubAllEnvs()
  supa.updateUserById.mockReset()
  ids = await seedUsuarios()
  await sqlAdmin`update usuarios set activo = true`
  como(ids.admin)
})
afterAll(async () => {
  await closeSql()
  await closeDb()
})

describe('desactivarUsuario / reactivarUsuario', () => {
  it('admin desactiva a un usuario del equipo: pierde la sesión y su sesión vieja no lee nada (F13)', async () => {
    const sesionVieja = (await cargarSesion(ids.equipo))!
    expect(await withSession(sesionVieja, (sql) => sql`select id from propietarios`)).toHaveLength(2)

    expect(await usr.desactivarUsuario(ids.equipo)).toEqual({ ok: true, id: ids.equipo })
    expect(await activo(ids.equipo)).toBe(false)
    expect(await cargarSesion(ids.equipo)).toBeNull()
    expect(await withSession(sesionVieja, (sql) => sql`select id from propietarios`)).toEqual([])
    expect(await withSession(sesionVieja, (sql) => sql`select app.rol_actual() as rol`)).toEqual([{ rol: null }])
    expect(supa.updateUserById).not.toHaveBeenCalled() // AUTH_PROVIDER=local

    okId(await usr.reactivarUsuario(ids.equipo))
    expect(await activo(ids.equipo)).toBe(true)
    expect(await cargarSesion(ids.equipo)).not.toBeNull()
  })

  it('usuario del portal desactivado: el portal no le muestra nada', async () => {
    const sesion = (await cargarSesion(ids.propA))!
    okId(await usr.desactivarUsuario(ids.propA))
    expect(await withSession(sesion, (sql) => sql`select * from portal_propietario`)).toEqual([])
  })

  it('no se desactiva a sí mismo ni al usuario sistema; ids inválidos o inexistentes', async () => {
    expect(await usr.desactivarUsuario(ids.admin)).toEqual({
      ok: false, errores: { _form: 'No puedes desactivar tu propio usuario' },
    })
    expect(await usr.desactivarUsuario(SISTEMA)).toEqual({
      ok: false, errores: { _form: 'El usuario sistema no se puede desactivar' },
    })
    expect(await usr.desactivarUsuario('x')).toEqual({ ok: false, errores: { _form: 'Usuario inválido' } })
    expect(await usr.desactivarUsuario('00000000-0000-0000-0000-000000000999')).toEqual({
      ok: false, errores: { _form: 'El usuario no existe' },
    })
    expect(await activo(ids.admin)).toBe(true)
  })

  it('sólo admin', async () => {
    como(ids.equipo)
    await expect(usr.desactivarUsuario(ids.propA)).rejects.toThrow(FORBIDDEN)
    await expect(usr.reactivarUsuario(ids.propA)).rejects.toThrow(FORBIDDEN)
    como(ids.propA)
    await expect(usr.desactivarUsuario(ids.propB)).rejects.toThrow(FORBIDDEN)
    expect(await activo(ids.propB)).toBe(true)
  })

  it('con Supabase bloquea al usuario en Auth (cierra sus sesiones); si falla, igual queda inactivo', async () => {
    vi.stubEnv('AUTH_PROVIDER', 'supabase')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://x.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service')
    // Con AUTH_PROVIDER=supabase la acción leería la sesión de Supabase: se prueba la función interna.
    const admin = (await cargarSesion(ids.admin))!
    const desactivarConSesion = (s: typeof admin, id: string) => cambiarActivoUsuario(s, id, false)
    const reactivarConSesion = (s: typeof admin, id: string) => cambiarActivoUsuario(s, id, true)

    supa.updateUserById.mockResolvedValue({ data: {}, error: null })
    okId(await desactivarConSesion(admin, ids.equipo))
    expect(supa.updateUserById).toHaveBeenLastCalledWith(ids.equipo, { ban_duration: '876000h' })
    okId(await reactivarConSesion(admin, ids.equipo))
    expect(supa.updateUserById).toHaveBeenLastCalledWith(ids.equipo, { ban_duration: 'none' })

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    supa.updateUserById.mockResolvedValue({ data: null, error: { message: 'caído' } })
    try {
      expect(await desactivarConSesion(admin, ids.equipo)).toEqual({
        ok: true,
        id: ids.equipo,
        advertencia: 'El usuario quedó desactivado, pero no se pudieron cerrar sus sesiones en Supabase',
      })
      expect(error).toHaveBeenCalled()
    } finally {
      error.mockRestore()
    }
    expect(await activo(ids.equipo)).toBe(false)
  })

  it('listarUsuariosEquipo: admin y equipo (sin propietarios ni sistema)', async () => {
    const sesion = (await cargarSesion(ids.admin))!
    const filas = await withSession(sesion, listarUsuariosEquipo)
    expect(filas.map((f) => [f.email, f.rol, f.activo])).toEqual([
      ['admin@local', 'admin', true],
      ['equipo@local', 'equipo', true],
    ])
  })
})
