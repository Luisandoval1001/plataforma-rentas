import { withUsuario } from '@/lib/db'
import type { Rol, Session } from './types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Arma la Session de un usuario activo vía app.sesion_actual(); null si no existe o está inactivo. */
export async function cargarSesion(usuarioId: string): Promise<Session | null> {
  if (!UUID.test(usuarioId)) return null
  const rows = await withUsuario(usuarioId, (sql) => sql<
    { usuario_id: string; email: string; rol: Rol; propietario_ids: string[] }[]
  >`select usuario_id, email, rol, propietario_ids from app.sesion_actual()`)
  const r = rows[0]
  if (!r) return null
  return { usuarioId: r.usuario_id, email: r.email, rol: r.rol, propietarioIds: r.propietario_ids }
}
