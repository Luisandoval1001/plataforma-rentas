'use server'

import { cookies } from 'next/headers'
import { proveedorAuth } from '@/lib/auth/proveedor'
import { notFound, redirect } from 'next/navigation'
import { cargarSesion } from '@/lib/auth/cargar'
import { crearCookieLocal } from '@/lib/auth/providers/local'
import { rutaInicio } from '@/lib/auth/session'

export async function entrarComo(formData: FormData) {
  if (proveedorAuth() !== 'local') notFound()
  const sesion = await cargarSesion(String(formData.get('usuarioId') ?? ''))
  if (!sesion) redirect('/dev-login')
  const { name, value, options } = crearCookieLocal(sesion.usuarioId)
  ;(await cookies()).set(name, value, options)
  redirect(rutaInicio(sesion.rol))
}
