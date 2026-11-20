'use server'

import { ejecutar, ErrorNegocio, esUuid, fallo, type Resultado } from '@/lib/acciones'
import { invitarPorCorreoSupabase } from '@/lib/auth/invitar'
import { proveedorAuth } from '@/lib/auth/proveedor'
import { requireRol } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import { validar } from '@/lib/validators/comun'
import { invitacionSchema, propietarioSchema } from '@/lib/validators/propietario'

export async function crearPropietario(formData: FormData): Promise<Resultado> {
  const session = await requireRol('admin')
  const v = validar(propietarioSchema, formData)
  if (!v.ok) return v
  return ejecutar(() =>
    withSession(session, async (sql) => {
      const [r] = await sql<{ id: string }[]>`insert into propietarios ${sql(v.data)} returning id`
      return r.id
    }),
  )
}

export async function actualizarPropietario(propietarioId: string, formData: FormData): Promise<Resultado> {
  const session = await requireRol('admin')
  if (!esUuid(propietarioId)) return fallo('_form', 'Propietario inválido')
  const v = validar(propietarioSchema, formData)
  if (!v.ok) return v
  return ejecutar(() =>
    withSession(session, async (sql) => {
      const [r] = await sql<{ id: string }[]>`
        update propietarios set ${sql(v.data)} where id = ${propietarioId} returning id`
      if (!r) throw new ErrorNegocio('_form', 'Propietario no encontrado')
      return r.id
    }),
  )
}

/**
 * Da acceso al portal a un usuario del propietario. Si el correo ya es de un usuario propietario,
 * sólo lo liga. Local: crea el renglón en `usuarios`; Supabase: invita por correo y usa su id.
 */
export async function invitarUsuarioPropietario(propietarioId: string, formData: FormData): Promise<Resultado> {
  const session = await requireRol('admin')
  if (!esUuid(propietarioId)) return fallo('_form', 'Propietario inválido')
  const v = validar(invitacionSchema, formData)
  if (!v.ok) return v
  const { email, nombre } = v.data
  return ejecutar(() =>
    withSession(session, async (sql) => {
      const [existente] = await sql<{ id: string; rol: string }[]>`
        select id, rol from usuarios where lower(email) = ${email}`
      let usuarioId: string
      if (existente) {
        if (existente.rol !== 'propietario') {
          throw new ErrorNegocio('email', 'Ese correo pertenece a un usuario del equipo')
        }
        usuarioId = existente.id
      } else {
        const id = proveedorAuth() === 'supabase' ? await invitarPorCorreoSupabase(email, nombre) : null
        const [u] = await sql<{ id: string }[]>`
          insert into usuarios (id, email, nombre, rol)
          values (coalesce(${id}::uuid, gen_random_uuid()), ${email}, ${nombre}, 'propietario')
          returning id`
        usuarioId = u.id
      }
      await sql`
        insert into propietario_usuarios (propietario_id, usuario_id)
        values (${propietarioId}, ${usuarioId})
        on conflict do nothing`
      return usuarioId
    }),
  )
}
