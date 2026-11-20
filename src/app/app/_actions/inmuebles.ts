'use server'

import { ejecutar, ErrorNegocio, esUuid, fallo, type Resultado } from '@/lib/acciones'
import { requireRol } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import type { Sql } from '@/lib/queries/tipos'
import { validar } from '@/lib/validators/comun'
import { inmuebleEdicionSchema, inmuebleSchema } from '@/lib/validators/inmueble'

async function validarCobrador(sql: Sql, cobradorId: string | null) {
  if (!cobradorId) return
  const [u] = await sql`
    select 1 from usuarios where id = ${cobradorId} and rol in ('admin', 'equipo') and activo`
  if (!u) throw new ErrorNegocio('cobrador_id', 'El cobrador debe ser un usuario activo del equipo')
}

export async function crearInmueble(formData: FormData): Promise<Resultado> {
  const session = await requireRol('admin', 'equipo')
  const v = validar(inmuebleSchema, formData)
  if (!v.ok) return v
  return ejecutar(() =>
    withSession(session, async (sql) => {
      await validarCobrador(sql, v.data.cobrador_id)
      const [r] = await sql<{ id: string }[]>`insert into inmuebles ${sql(v.data)} returning id`
      return r.id
    }),
  )
}

/** Datos y cobrador asignado. El propietario del inmueble no se cambia desde aquí. */
export async function actualizarInmueble(inmuebleId: string, formData: FormData): Promise<Resultado> {
  const session = await requireRol('admin', 'equipo')
  if (!esUuid(inmuebleId)) return fallo('_form', 'Inmueble inválido')
  const v = validar(inmuebleEdicionSchema, formData)
  if (!v.ok) return v
  return ejecutar(() =>
    withSession(session, async (sql) => {
      await validarCobrador(sql, v.data.cobrador_id)
      const [r] = await sql<{ id: string }[]>`
        update inmuebles set ${sql(v.data)} where id = ${inmuebleId} returning id`
      if (!r) throw new ErrorNegocio('_form', 'Inmueble no encontrado')
      return r.id
    }),
  )
}
