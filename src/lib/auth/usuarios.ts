import { ejecutar, ErrorNegocio, esUuid, fallo, type Resultado } from '@/lib/acciones'
import { withSession } from '@/lib/db'
import { bloquearEnSupabase } from './invitar'
import { proveedorAuth } from './proveedor'
import type { Session } from './types'

const SISTEMA = '00000000-0000-0000-0000-000000000001'

/**
 * Activa o desactiva un usuario (sólo admin; RLS lo exige también). Desactivado: la BD le niega todo
 * (app.rol_actual() nulo, 0009) y cargarSesion devuelve null. Con Supabase además se bloquea en Auth,
 * lo que revoca sus sesiones; es best effort: si falla, el usuario queda inactivo con advertencia.
 */
export async function cambiarActivoUsuario(session: Session, usuarioId: string, activo: boolean): Promise<Resultado> {
  if (!esUuid(usuarioId)) return fallo('_form', 'Usuario inválido')
  if (!activo && usuarioId === session.usuarioId) return fallo('_form', 'No puedes desactivar tu propio usuario')
  if (usuarioId === SISTEMA) return fallo('_form', 'El usuario sistema no se puede desactivar')
  const r = await ejecutar(() =>
    withSession(session, async (sql) => {
      const [u] = await sql<{ id: string }[]>`
        update usuarios set activo = ${activo} where id = ${usuarioId} returning id`
      if (!u) throw new ErrorNegocio('_form', 'El usuario no existe')
      return u.id
    }),
  )
  if (!r.ok || proveedorAuth() !== 'supabase') return r
  try {
    await bloquearEnSupabase(usuarioId, !activo)
    return r
  } catch (err) {
    console.error('No se pudo actualizar el usuario en Supabase Auth', usuarioId, err)
    return activo
      ? { ...r, advertencia: 'El usuario quedó activo, pero no se pudo desbloquear en Supabase' }
      : { ...r, advertencia: 'El usuario quedó desactivado, pero no se pudieron cerrar sus sesiones en Supabase' }
  }
}
