'use server'

import { ejecutar, ErrorNegocio, esUuid, fallo, type Resultado } from '@/lib/acciones'
import { requireRol } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import { asegurarSinVigente, rutaPdfContrato } from '@/lib/queries/contratos'
import { insertarInquilino } from '@/lib/queries/inquilinos'
import type { Sql } from '@/lib/queries/tipos'
import { putFile } from '@/lib/storage'
import { leerPdf } from '@/lib/validators/archivo'
import { validar } from '@/lib/validators/comun'
import { contratoSchema } from '@/lib/validators/contrato'

/** Sube el PDF a `propietarios/<pid>/contratos/<id>.pdf` y lo liga al contrato (misma transacción). */
async function guardarPdf(sql: Sql, contratoId: string, propietarioId: string, pdf: Buffer) {
  const path = rutaPdfContrato(propietarioId, contratoId)
  await putFile(path, pdf, 'application/pdf')
  await sql`update contratos set pdf_path = ${path} where id = ${contratoId}`
}

export async function crearContrato(formData: FormData): Promise<Resultado> {
  const session = await requireRol('admin', 'equipo')
  const v = validar(contratoSchema, formData)
  const pdf = await leerPdf(formData, 'pdf', false)
  if (!v.ok || !pdf.ok) return { ok: false, errores: { ...(v.ok ? {} : v.errores), ...(pdf.ok ? {} : pdf.errores) } }
  const d = v.data
  return ejecutar(() =>
    withSession(session, async (sql) => {
      await asegurarSinVigente(sql, d.unidad_id)
      const inquilinoId =
        d.inquilino_id ??
        (await insertarInquilino(sql, {
          nombre: d.inquilino_nombre ?? '',
          email: d.inquilino_email,
          telefono: d.inquilino_telefono,
          rfc: d.inquilino_rfc,
        }))
      const [c] = await sql<{ id: string; propietario_id: string }[]>`
        insert into contratos (unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual,
                               dia_pago, deposito, incremento_anual_pct, estatus)
        values (${d.unidad_id}, ${inquilinoId}, ${d.fecha_inicio}, ${d.fecha_fin}, ${d.renta_mensual},
                ${d.dia_pago}, ${d.deposito}, ${d.incremento_anual_pct}, 'vigente')
        returning id, propietario_id`
      if (pdf.data) await guardarPdf(sql, c.id, c.propietario_id, pdf.data)
      return c.id
    }),
  )
}

/**
 * Crea la renovación de un contrato vigente: pendiente de firma desde hoy, inicia al día siguiente
 * del fin, dura un año y aplica el incremento anual pactado a la renta vigente del último mes del
 * contrato (en contratos de varios años ya incluye los incrementos anteriores).
 */
export async function renovarContrato(contratoId: string): Promise<Resultado> {
  const session = await requireRol('admin', 'equipo')
  if (!esUuid(contratoId)) return fallo('_form', 'Contrato inválido')
  return ejecutar(() =>
    withSession(session, async (sql) => {
      const [c] = await sql<{ estatus: string }[]>`
        select estatus from contratos where id = ${contratoId} for update`
      if (!c) throw new ErrorNegocio('_form', 'Contrato no encontrado')
      if (c.estatus !== 'vigente') throw new ErrorNegocio('_form', 'Sólo se renueva un contrato vigente')
      const [ya] = await sql`
        select 1 from contratos where contrato_origen_id = ${contratoId} and estatus <> 'terminado'`
      if (ya) throw new ErrorNegocio('_form', 'Este contrato ya tiene una renovación')
      const [n] = await sql<{ id: string }[]>`
        insert into contratos (unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago,
                               deposito, incremento_anual_pct, estatus, pendiente_firma_desde,
                               contrato_origen_id)
        select unidad_id, inquilino_id, fecha_fin + 1,
               (fecha_fin + 1 + interval '1 year' - interval '1 day')::date,
               round(app.renta_vigente(renta_mensual, incremento_anual_pct, fecha_inicio,
                                       date_trunc('month', fecha_fin)::date)
                     * (1 + incremento_anual_pct / 100), 2), dia_pago, deposito,
               incremento_anual_pct, 'pendiente_firma', current_date, id
        from contratos where id = ${contratoId}
        returning id`
      return n.id
    }),
  )
}

/**
 * Pendiente de firma → vigente con el PDF firmado; el contrato de origen pasa a terminado. Si se
 * activa antes de la fecha_fin del origen, generar_cargos_renta sigue cobrando el origen hasta esa
 * fecha y la renovación desde el mes siguiente (0009).
 */
export async function activarContrato(contratoId: string, formData: FormData): Promise<Resultado> {
  const session = await requireRol('admin', 'equipo')
  if (!esUuid(contratoId)) return fallo('_form', 'Contrato inválido')
  const pdf = await leerPdf(formData, 'pdf', true)
  if (!pdf.ok) return pdf
  return ejecutar(() =>
    withSession(session, async (sql) => {
      const [c] = await sql<{ estatus: string; unidad_id: string; propietario_id: string; contrato_origen_id: string | null }[]>`
        select estatus, unidad_id, propietario_id, contrato_origen_id
        from contratos where id = ${contratoId} for update`
      if (!c) throw new ErrorNegocio('_form', 'Contrato no encontrado')
      if (c.estatus !== 'pendiente_firma') throw new ErrorNegocio('_form', 'El contrato no está pendiente de firma')
      await asegurarSinVigente(sql, c.unidad_id, c.contrato_origen_id)
      if (c.contrato_origen_id) {
        await sql`update contratos set estatus = 'terminado'
                  where id = ${c.contrato_origen_id} and estatus = 'vigente'`
      }
      await sql`update contratos set estatus = 'vigente' where id = ${contratoId}`
      await guardarPdf(sql, contratoId, c.propietario_id, pdf.data as Buffer)
      return contratoId
    }),
  )
}

export async function terminarContrato(contratoId: string): Promise<Resultado> {
  const session = await requireRol('admin', 'equipo')
  if (!esUuid(contratoId)) return fallo('_form', 'Contrato inválido')
  return ejecutar(() =>
    withSession(session, async (sql) => {
      const [r] = await sql<{ id: string }[]>`
        update contratos set estatus = 'terminado'
        where id = ${contratoId} and estatus = 'vigente' returning id`
      if (!r) throw new ErrorNegocio('_form', 'Sólo se termina un contrato vigente')
      return r.id
    }),
  )
}
