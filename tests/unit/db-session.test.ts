import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, resetDb, seedUsuarios, sqlAdmin } from '../db/harness'
import { closeSql, withSession } from '@/lib/db'
import { cargarSesion } from '@/lib/auth/cargar'
import type { Session } from '@/lib/auth/session'

let ids: Awaited<ReturnType<typeof seedUsuarios>>
let sesionPropA: Session
let sesionEquipo: Session

beforeAll(async () => {
  await resetDb()
  ids = await seedUsuarios()
  await sqlAdmin`
    insert into inmuebles (propietario_id, nombre, tipo) values
      (${ids.propietarioA}, 'Edificio A', 'edificio'),
      (${ids.propietarioB}, 'Edificio B', 'edificio')`
  await sqlAdmin`update usuarios set activo = false where id = ${ids.propB}`
  sesionPropA = { usuarioId: ids.propA, email: 'propa@local', rol: 'propietario', propietarioIds: [ids.propietarioA] }
  sesionEquipo = { usuarioId: ids.equipo, email: 'equipo@local', rol: 'equipo', propietarioIds: [] }
})

afterAll(async () => {
  await closeSql()
  await closeDb()
})

describe('withSession', () => {
  it('aplica RLS: el propietario A sólo ve sus inmuebles', async () => {
    const rows = await withSession(sesionPropA, (sql) => sql`select nombre, propietario_id from inmuebles`)
    expect(rows.map((r) => r.nombre)).toEqual(['Edificio A'])
  })

  it('equipo no puede insertar propietarios', async () => {
    await expect(
      withSession(sesionEquipo, (sql) =>
        sql`insert into propietarios (nombre, modelo) values ('X', 'cobra_disa')`,
      ),
    ).rejects.toThrow(/row-level security/)
  })

  it('app.sesion_actual() devuelve rol y propietario_ids del usuario', async () => {
    const rows = await withSession(sesionPropA, (sql) => sql`select * from app.sesion_actual()`)
    expect(rows).toHaveLength(1)
    expect(rows[0].rol).toBe('propietario')
    expect(rows[0].email).toBe('propa@local')
    expect(rows[0].propietario_ids).toEqual([ids.propietarioA])
  })
})

describe('cargarSesion', () => {
  it('arma la Session a partir del usuarioId', async () => {
    expect(await cargarSesion(ids.propA)).toEqual(sesionPropA)
    expect(await cargarSesion(ids.admin)).toEqual({
      usuarioId: ids.admin, email: 'admin@local', rol: 'admin', propietarioIds: [],
    })
  })

  it('devuelve null si el usuario está inactivo o no existe', async () => {
    expect(await cargarSesion(ids.propB)).toBeNull()
    expect(await cargarSesion('00000000-0000-0000-0000-0000000000ff')).toBeNull()
  })

  it('devuelve null si el id no es un uuid', async () => {
    expect(await cargarSesion('no-es-uuid')).toBeNull()
  })
})

describe('app.usuarios_dev_login()', () => {
  async function listar(devLogin: 'on' | 'off') {
    return sqlAdmin.begin(async (tx) => {
      await tx`set local role app_server`
      await tx`select set_config('app.dev_login', ${devLogin}, true)`
      return tx`select email from app.usuarios_dev_login()`
    })
  }

  it('sin app.dev_login = on no devuelve filas', async () => {
    expect(await listar('off')).toEqual([])
  })

  it('con app.dev_login = on lista usuarios activos', async () => {
    const emails = (await listar('on')).map((r) => r.email)
    expect(emails).toContain('propa@local')
    expect(emails).not.toContain('propb@local')
  })

  it('también se enciende con el interruptor guardado en app.configuracion (Supabase: sin GUC propios)', async () => {
    const filas = await sqlAdmin.begin(async (tx) => {
      await tx`insert into app.configuracion (clave, valor) values ('dev_login', 'on')`
      await tx`set local role app_server`
      await tx`select set_config('app.dev_login', 'off', true)`
      const r = await tx`select email from app.usuarios_dev_login()`
      await tx`reset role`
      await tx`delete from app.configuracion where clave = 'dev_login'`
      return r
    })
    expect(filas.map((r) => r.email)).toContain('propa@local')
  })

  it('app_server no puede leer ni cambiar el interruptor', async () => {
    const intento = (q: 'leer' | 'escribir') =>
      sqlAdmin.begin(async (tx) => {
        await tx`set local role app_server`
        return q === 'leer'
          ? tx`select * from app.configuracion`
          : tx`insert into app.configuracion (clave, valor) values ('dev_login', 'on')`
      })
    await expect(intento('leer')).rejects.toThrow(/permission denied/)
    await expect(intento('escribir')).rejects.toThrow(/permission denied/)
  })

  it('la base local trae app.dev_login = on por defecto', async () => {
    const [r] = await sqlAdmin`select current_setting('app.dev_login', true) as v`
    expect(r.v).toBe('on')
  })
})
