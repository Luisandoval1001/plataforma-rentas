'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { cargarSesion } from './cargar'
import { proveedorAuth } from './proveedor'
import { SESION_COOKIE } from './providers/local'
import { crearClienteSupabase } from './providers/supabase'
import { rutaInicio } from './session'

export type EstadoLogin = { estado: 'inicial' | 'enviado' | 'error' }

const email = z.string().trim().toLowerCase().email()

/** Cierra la sesión del proveedor activo y lleva al login. */
export async function cerrarSesion(): Promise<void> {
  if (proveedorAuth() === 'supabase') {
    await (await crearClienteSupabase()).auth.signOut()
  } else {
    ;(await cookies()).delete(SESION_COOKIE)
  }
  redirect('/login')
}

function urlConfigurada(nombre: 'APP_URL' | 'CLIENTES_URL'): URL {
  const valor = process.env[nombre]
  if (!valor) throw new Error(`Falta ${nombre}`)
  return new URL(valor)
}

/**
 * Regreso del enlace del correo: SÓLO de configuración (APP_URL / CLIENTES_URL), nunca de un
 * encabezado. El host de la petición únicamente elige entre esos dos; si no coincide con
 * ninguno, CLIENTES_URL.
 */
async function urlRegreso(): Promise<string> {
  const host = ((await headers()).get('host') ?? '').toLowerCase()
  const app = urlConfigurada('APP_URL')
  const base = host === app.host ? app : urlConfigurada('CLIENTES_URL')
  return new URL('/auth/callback', base).toString()
}

/**
 * Envía el enlace de acceso (supabase). Siempre responde 'enviado' con un correo bien formado,
 * exista o no la cuenta (sin enumeración); shouldCreateUser: false evita altas por esta vía.
 * La plantilla "Magic Link" arma el enlace con {{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email
 * (docs/despliegue.md §6): /auth/callback lo verifica con verifyOtp, sin verificador PKCE, así que
 * funciona aunque se abra en otro dispositivo o navegador.
 */
export async function enviarEnlaceAcceso(_: EstadoLogin, fd: FormData): Promise<EstadoLogin> {
  if (proveedorAuth() !== 'supabase') return { estado: 'error' }
  const correo = email.safeParse(fd.get('email'))
  if (!correo.success) return { estado: 'error' }
  const supabase = await crearClienteSupabase()
  await supabase.auth.signInWithOtp({
    email: correo.data,
    options: { shouldCreateUser: false, emailRedirectTo: await urlRegreso() },
  })
  return { estado: 'enviado' }
}

/** Acceso con contraseña (supabase); redirige por rol o devuelve error genérico. */
export async function entrarConContrasena(_: EstadoLogin, fd: FormData): Promise<EstadoLogin> {
  if (proveedorAuth() !== 'supabase') return { estado: 'error' }
  const correo = email.safeParse(fd.get('email'))
  const contrasena = String(fd.get('contrasena') ?? '')
  if (!correo.success || !contrasena) return { estado: 'error' }
  const supabase = await crearClienteSupabase()
  const { data, error } = await supabase.auth.signInWithPassword({ email: correo.data, password: contrasena })
  const sesion = !error && data.user ? await cargarSesion(data.user.id) : null
  if (!sesion) {
    if (!error) await supabase.auth.signOut()
    return { estado: 'error' }
  }
  redirect(rutaInicio(sesion.rol))
}
