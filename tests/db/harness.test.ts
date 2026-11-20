import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { asUser, closeDb, resetDb, seedUsuarios } from './harness'

describe('arnés de pruebas de BD', () => {
  beforeAll(async () => {
    await resetDb()
  })
  afterAll(async () => {
    await closeDb()
  })

  test('asUser fija app.uid()', async () => {
    const u = await seedUsuarios()
    const r = await asUser(u.admin, (s) => s`select app.uid() as id`)
    expect(r[0].id).toBe(u.admin)
  })

  test('asUser corre como app_server, no como superusuario', async () => {
    const u = await seedUsuarios()
    const r = await asUser(
      u.admin,
      (s) => s`
        select current_user as usuario,
               (select rolsuper from pg_roles where rolname = current_user) as su`,
    )
    expect(r[0].usuario).toBe('app_server')
    expect(r[0].su).toBe(false)
  })

  test('app_server no tiene acceso al esquema auth (como en Supabase)', async () => {
    const u = await seedUsuarios()
    const r = await asUser(
      u.admin,
      (s) => s`select has_schema_privilege('app_server', 'auth', 'usage') as uso`,
    )
    expect(r[0].uso).toBe(false)
  })
})
