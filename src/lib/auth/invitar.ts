import { createClient } from '@supabase/supabase-js'

/** Cliente de administración de Supabase Auth (service role; sólo servidor). */
function adminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Invita por correo con Supabase Auth (service role) y devuelve el id del usuario creado. */
export async function invitarPorCorreoSupabase(email: string, nombre: string): Promise<string> {
  const { data, error } = await adminSupabase().auth.admin.inviteUserByEmail(email, { data: { nombre } })
  if (error || !data.user) throw error ?? new Error('Supabase no devolvió el usuario invitado')
  return data.user.id
}

/**
 * Bloquea (o desbloquea) al usuario en Supabase Auth. El bloqueo invalida sus refresh tokens: no puede
 * volver a entrar ni renovar la sesión. (auth.admin.signOut exige el JWT del usuario, no su id, así que
 * no sirve para cerrar sesiones ajenas.)
 */
export async function bloquearEnSupabase(usuarioId: string, bloquear: boolean): Promise<void> {
  const { error } = await adminSupabase().auth.admin.updateUserById(usuarioId, {
    ban_duration: bloquear ? '876000h' : 'none',
  })
  if (error) throw error
}
