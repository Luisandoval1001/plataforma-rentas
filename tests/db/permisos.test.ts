import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { closeDb, resetDb, sqlAdmin } from './harness'

const REGISTRAR_PAGO = 'registrar_pago(uuid[],numeric,date,text,text,cuenta_destino,text)'

async function tiene(consulta: Promise<{ ok: boolean }[]>): Promise<boolean> {
  return (await consulta)[0].ok
}

describe('endurecimiento de privilegios (0008_hardening)', () => {
  beforeAll(async () => {
    await resetDb()
  })
  afterAll(async () => {
    await closeDb()
  })

  test('anon no lee tablas ni ejecuta funciones', async () => {
    expect(await tiene(sqlAdmin`select has_table_privilege('anon', 'pagos', 'select') as ok`)).toBe(false)
    expect(await tiene(sqlAdmin`select has_table_privilege('anon', 'usuarios', 'select') as ok`)).toBe(false)
    expect(
      await tiene(sqlAdmin`select has_function_privilege('anon', ${REGISTRAR_PAGO}, 'execute') as ok`),
    ).toBe(false)
  })

  test('authenticated no escribe dinero ni bitácora ni trunca', async () => {
    for (const t of ['pagos', 'pago_aplicaciones', 'liquidaciones', 'liquidacion_lineas', 'ajustes_pendientes', 'bitacora']) {
      for (const p of ['insert', 'update', 'delete', 'truncate']) {
        expect(await tiene(sqlAdmin`select has_table_privilege('authenticated', ${t}, ${p}) as ok`), `${t} ${p}`).toBe(false)
      }
      expect(await tiene(sqlAdmin`select has_table_privilege('authenticated', ${t}, 'select') as ok`), `${t} select`).toBe(true)
    }
    expect(await tiene(sqlAdmin`select has_table_privilege('authenticated', 'cargos', 'truncate') as ok`)).toBe(false)
    expect(await tiene(sqlAdmin`select has_table_privilege('authenticated', 'portal_propietario', 'update') as ok`)).toBe(false)
  })

  test('authenticated y app_server conservan lo que usa la aplicación', async () => {
    for (const r of ['authenticated', 'app_server']) {
      expect(await tiene(sqlAdmin`select has_table_privilege(${r}, 'cargos', 'insert') as ok`)).toBe(true)
      expect(await tiene(sqlAdmin`select has_table_privilege(${r}, 'avisos_enviados', 'insert') as ok`)).toBe(true)
      expect(await tiene(sqlAdmin`select has_function_privilege(${r}, ${REGISTRAR_PAGO}, 'execute') as ok`)).toBe(true)
    }
    expect(await tiene(sqlAdmin`select has_table_privilege('app_server', 'pagos', 'truncate') as ok`)).toBe(false)
  })

  test('scripts/reaplicar-permisos.sql corre sin error, es idempotente y no cambia lo anterior', async () => {
    const archivo = readFileSync('scripts/reaplicar-permisos.sql', 'utf8')
    const antes = () => sqlAdmin`select relname, relacl::text from pg_class where relnamespace = 'public'::regnamespace order by 1`
    const previo = await antes()
    // Dentro de una transacción que se revierte, para no quitar app.usuarios_dev_login a otras pruebas.
    const err = new Error('rollback')
    let dentro: unknown
    await sqlAdmin
      .begin(async (tx) => {
        await tx.unsafe(archivo)
        await tx.unsafe(archivo)
        dentro = (await tx`select has_function_privilege('app_server', 'app.usuarios_dev_login()', 'execute') as ok`)[0]
        throw err
      })
      .catch((e) => {
        if (e !== err) throw e
      })
    expect(dentro).toEqual({ ok: false })
    expect(await antes()).toEqual(previo)
  })

  test('0008 revierte los privilegios por defecto de Supabase (ALL a anon y authenticated)', async () => {
    const hardening = readFileSync('supabase/migrations/0008_hardening.sql', 'utf8')
    const err = new Error('rollback')
    const r: Record<string, boolean> = {}
    await sqlAdmin
      .begin(async (tx) => {
        await tx.unsafe(`grant all on all tables in schema public to anon, authenticated;
          grant all on all sequences in schema public to anon, authenticated;
          grant execute on all functions in schema public to anon, authenticated`)
        await tx.unsafe(hardening)
        const q = async (k: string, c: Promise<{ ok: boolean }[]>) => { r[k] = (await c)[0].ok }
        await q('anonPagos', tx`select has_table_privilege('anon', 'pagos', 'select') as ok`)
        await q('anonFn', tx`select has_function_privilege('anon', ${REGISTRAR_PAGO}, 'execute') as ok`)
        await q('authPagosIns', tx`select has_table_privilege('authenticated', 'pagos', 'insert') as ok`)
        await q('authTrunc', tx`select has_table_privilege('authenticated', 'cargos', 'truncate') as ok`)
        await q('authCargosIns', tx`select has_table_privilege('authenticated', 'cargos', 'insert') as ok`)
        await q('authFn', tx`select has_function_privilege('authenticated', ${REGISTRAR_PAGO}, 'execute') as ok`)
        throw err
      })
      .catch((e) => {
        if (e !== err) throw e
      })
    expect(r).toEqual({
      anonPagos: false, anonFn: false, authPagosIns: false, authTrunc: false, authCargosIns: true, authFn: true,
    })
  })
})
