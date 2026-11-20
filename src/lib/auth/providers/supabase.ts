import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/** Cliente de Supabase ligado a las cookies de la petición. */
export async function crearClienteSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY')
  const store = await cookies()
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (lista) => {
        try {
          for (const { name, value, options } of lista) store.set(name, value, options)
        } catch {
          // En Server Components no se pueden escribir cookies; se refrescan en acciones/rutas.
        }
      },
    },
  })
}

/** usuarioId (= auth.users.id = usuarios.id) del usuario autenticado, o null. */
export async function leerSesionSupabase(): Promise<string | null> {
  const supabase = await crearClienteSupabase()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  return data.user.id
}
