import type { User } from '@supabase/supabase-js'
import { connection, type NextRequest, NextResponse } from 'next/server'
import { cargarSesion } from '@/lib/auth/cargar'
import { proveedorAuth } from '@/lib/auth/proveedor'
import { crearClienteSupabase } from '@/lib/auth/providers/supabase'
import { rutaInicio } from '@/lib/auth/session'

/** Tipos de enlace aceptados: acceso por correo e invitación (plantillas de docs/despliegue.md §6). */
const TIPOS = ['email', 'invite'] as const
type Tipo = (typeof TIPOS)[number]
const esTipo = (v: string | null): v is Tipo => (TIPOS as readonly (string | null)[]).includes(v)

/**
 * Regreso del enlace de acceso (supabase). Principal: `token_hash` + `type` (flujo de hash del token:
 * no depende de un verificador PKCE guardado en el navegador, así que el enlace sirve aunque se abra
 * en otro dispositivo) → verifyOtp. Respaldo: `code` (PKCE) → exchangeCodeForSession. Luego
 * redirige por rol; sin sesión válida (o usuario inactivo) → /login?error=enlace; si el host no es
 * el del rol (APP_URL / CLIENTES_URL), → /login de su host.
 */
export async function GET(request: NextRequest) {
  // Siempre dinámica: en el build (prerender) AUTH_PROVIDER puede no estar definido.
  await connection()
  if (proveedorAuth() !== 'supabase') return new NextResponse('No encontrado', { status: 404 })
  const destino = (ruta: string) => NextResponse.redirect(new URL(ruta, request.nextUrl.origin))
  const params = request.nextUrl.searchParams
  const tokenHash = params.get('token_hash')
  const tipo = params.get('type')
  const code = params.get('code')

  let resultado: { user: User | null; error: unknown }
  if (tokenHash) {
    if (!esTipo(tipo)) return destino('/login?error=enlace')
    const supabase = await crearClienteSupabase()
    const { data, error } = await supabase.auth.verifyOtp({ type: tipo, token_hash: tokenHash })
    resultado = { user: data.user, error }
  } else if (code) {
    const supabase = await crearClienteSupabase()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    resultado = { user: data.user, error }
  } else {
    return destino('/login?error=enlace')
  }

  const sesion = !resultado.error && resultado.user ? await cargarSesion(resultado.user.id) : null
  if (!sesion) {
    if (!resultado.error) await (await crearClienteSupabase()).auth.signOut()
    return destino('/login?error=enlace')
  }
  // La sesión (cookies) queda en este host. Si es el host del otro tipo de usuario (p. ej. alguien del
  // equipo que aceptó la invitación en clientes.*), se le manda a entrar en su host.
  const propio = process.env[sesion.rol === 'propietario' ? 'CLIENTES_URL' : 'APP_URL']
  if (propio && new URL(propio).host !== request.nextUrl.host) {
    return NextResponse.redirect(new URL('/login?aviso=entra', propio))
  }
  return destino(rutaInicio(sesion.rol))
}
