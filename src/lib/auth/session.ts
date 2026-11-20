import { cookies } from 'next/headers'
import { forbidden, redirect } from 'next/navigation'
import { cargarSesion } from './cargar'
import { proveedorAuth } from './proveedor'
import { leerSesionLocal } from './providers/local'
import { leerSesionSupabase } from './providers/supabase'
import type { Rol, Session } from './types'

export type { Rol, Session } from './types'

async function usuarioIdActual(): Promise<string | null> {
  // Primero el dato de la petición: en el prerender (cacheComponents) suspende aquí, antes de
  // validar AUTH_PROVIDER, que en el build puede no estar definido.
  const jar = await cookies()
  if (proveedorAuth() === 'supabase') return leerSesionSupabase()
  return leerSesionLocal(jar)
}

export async function getSession(): Promise<Session | null> {
  const usuarioId = await usuarioIdActual()
  return usuarioId ? cargarSesion(usuarioId) : null
}

/** Sin sesión → redirect('/login'); rol no permitido → forbidden() (403, requiere experimental.authInterrupts). */
export async function requireRol(...roles: Rol[]): Promise<Session> {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!roles.includes(session.rol)) forbidden()
  return session
}

export function rutaInicio(rol: Rol): string {
  return rol === 'propietario' ? '/clientes' : '/app'
}
