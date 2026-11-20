import { execFileSync } from 'node:child_process'
import postgres from 'postgres'
import { ZONA_HORARIA } from '../../src/lib/formato'

const ADMIN_URL =
  process.env.DATABASE_ADMIN_URL ??
  'postgres://postgres:postgres@localhost:5432/rentas_test'

export const sqlAdmin = postgres(ADMIN_URL, { max: 5, onnotice: () => {} })

export type Sql = postgres.TransactionSql

export const IDS = {
  admin: '00000000-0000-0000-0000-00000000000a',
  equipo: '00000000-0000-0000-0000-00000000000b',
  propA: '00000000-0000-0000-0000-00000000000c',
  propB: '00000000-0000-0000-0000-00000000000d',
} as const

/** Recrea rentas_test: roles, shim de auth y migraciones. El drop usa WITH (force), que expulsa las sesiones del pool. */
export async function resetDb(): Promise<void> {
  execFileSync('bash', ['scripts/db-local.sh', 'reset', 'rentas_test'], {
    stdio: 'pipe',
    cwd: process.cwd(),
  })
}

/** Ejecuta fn como app_server con app.uid() = usuarioId (se revierte al terminar la transacción si fn lanza). */
export async function asUser<T>(
  usuarioId: string,
  fn: (sql: Sql) => Promise<T>,
): Promise<T> {
  const result = await sqlAdmin.begin(async (tx) => {
    await tx`set local role app_server`
    const claims = JSON.stringify({ sub: usuarioId, role: 'authenticated' })
    await tx`select set_config('request.jwt.claims', ${claims}, true)`
    await tx`select set_config('timezone', ${ZONA_HORARIA}, true)`
    return fn(tx)
  })
  return result as T
}

export const PROPIETARIOS = {
  A: '00000000-0000-0000-0000-0000000000a1',
  B: '00000000-0000-0000-0000-0000000000b1',
} as const

/** Devuelve ids fijos; si la tabla usuarios existe, inserta usuarios, propietarios A/B y sus ligas (idempotente). */
export async function seedUsuarios() {
  const existe = await sqlAdmin`select to_regclass('public.usuarios') as t`
  if (existe[0].t !== null) {
    await sqlAdmin.begin(async (tx) => {
      await tx`
        insert into usuarios (id, email, nombre, rol) values
          (${IDS.admin}, 'admin@local', 'Admin', 'admin'),
          (${IDS.equipo}, 'equipo@local', 'Equipo', 'equipo'),
          (${IDS.propA}, 'propa@local', 'Propietario A', 'propietario'),
          (${IDS.propB}, 'propb@local', 'Propietario B', 'propietario')
        on conflict do nothing`
      await tx`
        insert into propietarios (id, nombre, modelo, comision_pct) values
          (${PROPIETARIOS.A}, 'A', 'cobra_disa', 15),
          (${PROPIETARIOS.B}, 'B', 'cobra_disa', 12)
        on conflict do nothing`
      await tx`
        insert into propietario_usuarios (propietario_id, usuario_id) values
          (${PROPIETARIOS.A}, ${IDS.propA}),
          (${PROPIETARIOS.B}, ${IDS.propB})
        on conflict do nothing`
    })
  }
  return { ...IDS, propietarioA: PROPIETARIOS.A, propietarioB: PROPIETARIOS.B }
}

export async function closeDb(): Promise<void> {
  await sqlAdmin.end({ timeout: 5 }).catch(() => {})
}
