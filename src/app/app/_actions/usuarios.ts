'use server'

import type { Resultado } from '@/lib/acciones'
import { requireRol } from '@/lib/auth/session'
import { cambiarActivoUsuario } from '@/lib/auth/usuarios'

/** Sólo admin: el usuario (equipo o portal) pierde todo acceso de inmediato y se cierran sus sesiones. */
export async function desactivarUsuario(usuarioId: string): Promise<Resultado> {
  const session = await requireRol('admin')
  return cambiarActivoUsuario(session, usuarioId, false)
}

/** Sólo admin: devuelve el acceso a un usuario desactivado. */
export async function reactivarUsuario(usuarioId: string): Promise<Resultado> {
  const session = await requireRol('admin')
  return cambiarActivoUsuario(session, usuarioId, true)
}
