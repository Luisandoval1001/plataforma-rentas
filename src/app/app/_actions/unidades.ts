'use server'

import { ejecutar, esUuid, fallo, type Resultado } from '@/lib/acciones'
import { requireRol } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import { validar } from '@/lib/validators/comun'
import { unidadSchema } from '@/lib/validators/unidad'

export async function crearUnidad(inmuebleId: string, formData: FormData): Promise<Resultado> {
  const session = await requireRol('admin', 'equipo')
  if (!esUuid(inmuebleId)) return fallo('_form', 'Inmueble inválido')
  const v = validar(unidadSchema, formData)
  if (!v.ok) return v
  return ejecutar(() =>
    withSession(session, async (sql) => {
      const [r] = await sql<{ id: string }[]>`
        insert into unidades (inmueble_id, nombre) values (${inmuebleId}, ${v.data.nombre}) returning id`
      return r.id
    }),
  )
}
