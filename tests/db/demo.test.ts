import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { asUser, closeDb, resetDb, sqlAdmin } from './harness'

const ADMIN = 'd0000000-0000-4000-8000-000000000001'
const DUENO_EDIFICIO = 'd0000000-0000-4000-8000-000000000003'

describe('datos de demostración (demo/datos-demo.sql)', () => {
  beforeAll(async () => {
    await resetDb()
    const sql = readFileSync('demo/datos-demo.sql', 'utf8')
    await sqlAdmin.begin(async (tx) => {
      await tx`set local timezone = 'America/Mexico_City'`
      await tx.unsafe(sql).simple()
    })
  })
  afterAll(async () => {
    await closeDb()
  })

  test('el mes anterior queda cobrado y con las tres liquidaciones en borrador', async () => {
    const r = await asUser(ADMIN, (s) => s`
      select p.nombre, l.estatus, l.cobrado, l.neto
      from liquidaciones l join propietarios p on p.id = l.propietario_id
      where l.periodo = (date_trunc('month', current_date) - interval '1 month')::date
      order by p.nombre`)
    expect(r.map((x) => [x.nombre, x.estatus, Number(x.cobrado), Number(x.neto)])).toEqual([
      ['Copropietarios Edificio Río Elba 24', 'borrador', 97000, 75972],
      ['Familia Arriaga', 'borrador', 18000, -2505.6],
      ['Harbor Lane Company', 'borrador', 22000, 17272],
    ])
  })

  test('el mes en curso tiene pagados, un parcial y cargos sin pagar', async () => {
    const r = await asUser(ADMIN, (s) => s`
      select estatus, count(*)::int as n from v_cargos
      where periodo = date_trunc('month', current_date)::date group by estatus`)
    const por = Object.fromEntries(r.map((x) => [x.estatus, x.n]))
    expect(por.pagado).toBe(4)
    expect((por.parcial ?? 0) + (por.pendiente ?? 0) + (por.vencido ?? 0)).toBe(4)
  })

  test('el administrador puede cerrar el mes anterior y el dueño lo ve en su portal', async () => {
    await asUser(ADMIN, (s) => s`
      select cerrar_liquidacion(id) from liquidaciones
      where propietario_id = 'd1000000-0000-4000-8000-000000000001'`)
    const portal = await asUser(DUENO_EDIFICIO, (s) => s`select estatus, neto from portal_liquidaciones`)
    expect(portal.map((x) => [x.estatus, Number(x.neto)])).toEqual([['cerrada', 75972]])
  })

  test('el interruptor de /dev-login queda encendido y lista a los cuatro usuarios', async () => {
    const r = await sqlAdmin.begin(async (tx) => {
      await tx`set local role app_server`
      await tx`select set_config('app.dev_login', 'off', true)`
      return tx`select email from app.usuarios_dev_login() where email like '%@demo.local'`
    })
    expect(r).toHaveLength(4)
  })
})
