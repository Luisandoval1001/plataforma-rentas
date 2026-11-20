'use server'

import { ejecutar, type Resultado } from '@/lib/acciones'
import { requireRol } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import { insertarInquilino } from '@/lib/queries/inquilinos'
import { validar } from '@/lib/validators/comun'
import { inquilinoSchema } from '@/lib/validators/inquilino'

export async function crearInquilino(formData: FormData): Promise<Resultado> {
  const session = await requireRol('admin', 'equipo')
  const v = validar(inquilinoSchema, formData)
  if (!v.ok) return v
  return ejecutar(() => withSession(session, (sql) => insertarInquilino(sql, v.data)))
}
