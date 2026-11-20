'use server'

import { randomUUID } from 'node:crypto'
import { ejecutar, ErrorNegocio, esUuid, fallo, type Resultado } from '@/lib/acciones'
import { requireRol } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import { putFile } from '@/lib/storage'
import { leerArchivoDocumento, leerXml, type Comprobante } from '@/lib/validators/archivo'
import { validar } from '@/lib/validators/comun'
import { documentoSchema, metadatosDocumentoSchema } from '@/lib/validators/documento'

type Archivo = Comprobante & { id: string; path: string }

/**
 * Sube un documento del propietario a `propietarios/<pid>/documentos/<docId>.<ext>`. Factura:
 * `archivo` (PDF) y `xml` (CFDI, opcional) → dos documentos con el mismo nombre. Los archivos se
 * suben primero y luego se registran en una sola transacción (si la subida falla, no queda nada).
 */
export async function subirDocumento(propietarioId: string, formData: FormData): Promise<Resultado> {
  const session = await requireRol('admin', 'equipo')
  if (!esUuid(propietarioId)) return fallo('_form', 'Propietario inválido')
  const v = validar(documentoSchema, formData)
  const archivo = await leerArchivoDocumento(formData, 'archivo')
  const esFactura = v.ok && v.data.tipo === 'factura'
  const xml = esFactura ? await leerXml(formData, 'xml') : ({ ok: true, data: null } as const)
  const errores = {
    ...(v.ok ? {} : v.errores),
    ...(archivo.ok ? {} : archivo.errores),
    ...(xml.ok ? {} : xml.errores),
    ...(esFactura && archivo.ok && archivo.data.ext !== 'pdf' ? { archivo: 'La factura debe ser PDF' } : {}),
  }
  if (!v.ok || !archivo.ok || !xml.ok || Object.keys(errores).length > 0) return { ok: false, errores }
  const d = v.data

  const archivos: Archivo[] = [archivo.data, ...(xml.data ? [xml.data] : [])].map((c) => {
    const id = randomUUID()
    return { ...c, id, path: `propietarios/${propietarioId}/documentos/${id}.${c.ext}` }
  })
  try {
    for (const a of archivos) await putFile(a.path, a.data, a.contentType)
  } catch (err) {
    console.error('No se pudo subir el documento', err)
    return fallo('archivo', 'No se pudo guardar el archivo. Intenta de nuevo.')
  }
  return ejecutar(() =>
    withSession(session, async (sql) => {
      for (const a of archivos) {
        await sql`
          insert into documentos (id, propietario_id, tipo, nombre, path, unidad_id, pago_id, liquidacion_id, visible_propietario)
          values (${a.id}, ${propietarioId}, ${d.tipo}, ${d.nombre}, ${a.path}, ${d.unidadId}, ${d.pagoId},
                  ${d.liquidacionId}, ${d.visiblePropietario})`
      }
      return archivos[0].id
    }),
  )
}

/** Cambia nombre, tipo y visibilidad (lo único que equipo puede editar). */
export async function actualizarDocumento(
  id: string,
  datos: { nombre: string; tipo: string; visiblePropietario: boolean },
): Promise<Resultado> {
  const session = await requireRol('admin', 'equipo')
  if (!esUuid(id)) return fallo('_form', 'Documento inválido')
  const v = validar(metadatosDocumentoSchema, datos)
  if (!v.ok) return v
  return ejecutar(() =>
    withSession(session, async (sql) => {
      const [r] = await sql<{ id: string }[]>`
        update documentos set nombre = ${v.data.nombre}, tipo = ${v.data.tipo},
          visible_propietario = ${v.data.visiblePropietario}
        where id = ${id} returning id`
      if (!r) throw new ErrorNegocio('_form', 'El documento no existe')
      return r.id
    }),
  )
}

/** Sólo admin. Borra el registro (el archivo queda en el almacenamiento). */
export async function eliminarDocumento(id: string): Promise<Resultado> {
  const session = await requireRol('admin')
  if (!esUuid(id)) return fallo('_form', 'Documento inválido')
  return ejecutar(() =>
    withSession(session, async (sql) => {
      const [r] = await sql<{ id: string }[]>`delete from documentos where id = ${id} returning id`
      if (!r) throw new ErrorNegocio('_form', 'El documento no existe')
      return r.id
    }),
  )
}
