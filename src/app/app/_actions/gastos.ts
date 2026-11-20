'use server'

import { ejecutar, ErrorNegocio, esUuid, fallo, type Resultado } from '@/lib/acciones'
import { requireRol, type Session } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import { putFile } from '@/lib/storage'
import { leerComprobante, type Comprobante } from '@/lib/validators/archivo'
import { validar } from '@/lib/validators/comun'
import { gastoSchema } from '@/lib/validators/gasto'

/** Sube el comprobante y lo liga al gasto ya guardado (su propia transacción). Devuelve si se guardó. */
async function guardarComprobante(session: Session, gastoId: string, propietarioId: string, c: Comprobante) {
  try {
    const path = `propietarios/${propietarioId}/gastos/${gastoId}.${c.ext}`
    await putFile(path, c.data, c.contentType)
    await withSession(session, (sql) => sql`update gastos set comprobante_path = ${path} where id = ${gastoId}`)
    return true
  } catch (err) {
    console.error('No se pudo guardar el comprobante del gasto', gastoId, err)
    return false
  }
}

/** Registra un gasto (el propietario se deriva del inmueble) y después sube su comprobante. */
export async function crearGasto(formData: FormData): Promise<Resultado> {
  const session = await requireRol('admin', 'equipo')
  const v = validar(gastoSchema, formData)
  const comp = await leerComprobante(formData, 'comprobante')
  if (!v.ok || !comp.ok) return { ok: false, errores: { ...(v.ok ? {} : v.errores), ...(comp.ok ? {} : comp.errores) } }
  const d = v.data
  let propietarioId = ''
  const r = await ejecutar(() =>
    withSession(session, async (sql) => {
      const [g] = await sql<{ id: string; propietario_id: string }[]>`
        insert into gastos (inmueble_id, unidad_id, fecha, concepto, monto, pagado_por, autorizado_por)
        values (${d.inmuebleId}, ${d.unidadId}, ${d.fecha}, ${d.concepto}, ${d.monto}, ${d.pagadoPor}, ${d.autorizadoPor})
        returning id, propietario_id`
      propietarioId = g.propietario_id
      return g.id
    }),
  )
  if (!r.ok || !comp.data) return r
  return (await guardarComprobante(session, r.id, propietarioId, comp.data))
    ? r
    : { ...r, advertencia: 'El gasto se registró pero no se pudo guardar el comprobante' }
}

export async function actualizarGasto(id: string, formData: FormData): Promise<Resultado> {
  const session = await requireRol('admin', 'equipo')
  if (!esUuid(id)) return fallo('_form', 'Gasto inválido')
  const v = validar(gastoSchema, formData)
  if (!v.ok) return v
  const d = v.data
  return ejecutar(() =>
    withSession(session, async (sql) => {
      const [g] = await sql<{ id: string }[]>`
        update gastos set inmueble_id = ${d.inmuebleId}, unidad_id = ${d.unidadId}, fecha = ${d.fecha},
          concepto = ${d.concepto}, monto = ${d.monto}, pagado_por = ${d.pagadoPor}, autorizado_por = ${d.autorizadoPor}
        where id = ${id} returning id`
      if (!g) throw new ErrorNegocio('_form', 'El gasto no existe')
      return g.id
    }),
  )
}

/** Sólo admin. Un gasto ya liquidado no se borra (GASTO_LIQUIDADO). */
export async function eliminarGasto(id: string): Promise<Resultado> {
  const session = await requireRol('admin')
  if (!esUuid(id)) return fallo('_form', 'Gasto inválido')
  return ejecutar(() =>
    withSession(session, async (sql) => {
      const [g] = await sql<{ id: string }[]>`delete from gastos where id = ${id} returning id`
      if (!g) throw new ErrorNegocio('_form', 'El gasto no existe')
      return g.id
    }),
  )
}
