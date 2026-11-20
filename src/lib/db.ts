import postgres from 'postgres'
import type { Session } from '@/lib/auth/session'
import { ZONA_HORARIA } from '@/lib/formato'

let cliente: postgres.Sql | null = null

/** Cliente único (rol app_server, sujeto a RLS). Se crea al primer uso. */
export function getSql(): postgres.Sql {
  if (!cliente) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('Falta DATABASE_URL')
    // idle_timeout: en funciones serverless las conexiones ociosas se sueltan para no agotar el pooler.
    const max = Number(process.env.DB_POOL_MAX) || 5
    cliente = postgres(url, { max, idle_timeout: 20, onnotice: () => {} })
  }
  return cliente
}

export async function closeSql(): Promise<void> {
  const c = cliente
  cliente = null
  await c?.end({ timeout: 5 })
}

/** Transacción como app_server con app.uid() = usuarioId y current_date/now() en ZONA_HORARIA. */
export async function withUsuario<T>(
  usuarioId: string,
  fn: (sql: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  const claims = JSON.stringify({ sub: usuarioId, role: 'authenticated' })
  const result = await getSql().begin(async (tx) => {
    await tx`set local role app_server`
    await tx`select set_config('request.jwt.claims', ${claims}, true)`
    await tx`select set_config('timezone', ${ZONA_HORARIA}, true)`
    return fn(tx)
  })
  return result as T
}

/** Transacción con la identidad de la sesión: RLS decide qué renglones ve. */
export function withSession<T>(
  session: Session,
  fn: (sql: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return withUsuario(session.usuarioId, fn)
}
