'use server'

import { ejecutar, esUuid, fallo, type Resultado } from '@/lib/acciones'
import { requireRol, type Session } from '@/lib/auth/session'
import { correoEstadoCuenta } from '@/lib/avisos'
import { withSession } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import { renderEstadoCuentaPdf } from '@/lib/pdf/estado-cuenta'
import { liquidacionDetalleSql, type LiquidacionDetalle } from '@/lib/queries/liquidaciones'
import { putFile } from '@/lib/storage'
import { leerComprobante } from '@/lib/validators/archivo'
import { validar } from '@/lib/validators/comun'
import { ajusteSchema, pagoLiquidacionSchema, periodo } from '@/lib/validators/liquidacion'
import { z } from 'zod'

const prepararSchema = z.object({ periodo: periodo() })

/** Crea o reconstruye el borrador del propietario para el periodo 'YYYY-MM'. */
export async function prepararLiquidacion(propietarioId: string, periodoMes: string): Promise<Resultado> {
  const session = await requireRol('admin', 'equipo')
  if (!esUuid(propietarioId)) return fallo('_form', 'Propietario inválido')
  const v = validar(prepararSchema, { periodo: periodoMes })
  if (!v.ok) return v
  return ejecutar(() =>
    withSession(session, async (sql) => {
      const [{ id }] = await sql<{ id: string }[]>`
        select preparar_liquidacion(${propietarioId}, ${`${v.data.periodo}-01`}::date) as id`
      return id
    }),
  )
}

const n = (v: string) => Number(v)

/** Renderiza el PDF de una liquidación cerrada/pagada, lo sube y lo registra (pdf_path + documento reporte). */
async function generarPdf(session: Session, l: LiquidacionDetalle): Promise<void> {
  const pdf = await renderEstadoCuentaPdf(
    {
      propietario: { nombre: l.propietario.nombre, rfc: l.propietario.rfc },
      periodo: l.periodo,
      modelo: l.modelo,
      comisionPct: n(l.comision_pct),
      lineas: l.lineas.map((x) => ({ tipo: x.tipo, descripcion: x.descripcion, monto: n(x.monto) })),
      totales: {
        cobrado: n(l.cobrado),
        cobradoDisa: n(l.cobrado_disa),
        comision: n(l.comision),
        iva: n(l.iva),
        gastosDisa: n(l.gastos_disa),
        gastosPropietario: n(l.gastos_propietario),
        ajustes: n(l.ajustes),
        neto: n(l.neto),
      },
    },
    l.propietario.idioma,
  )
  const path = `propietarios/${l.propietario_id}/liquidaciones/${l.periodo}.pdf`
  await putFile(path, pdf, 'application/pdf')
  await withSession(session, async (sql) => {
    await sql`select registrar_pdf_liquidacion(${l.id}, ${path})`
    // Regenerar reescribe el mismo archivo: el documento ya existe y no se duplica.
    await sql`
      insert into documentos (propietario_id, tipo, nombre, path, liquidacion_id)
      select ${l.propietario_id}, 'reporte', ${`Estado de cuenta ${l.periodo}`}, ${path}, ${l.id}
      where not exists (select 1 from documentos where liquidacion_id = ${l.id} and path = ${path})`
  })
}

async function cargar(session: Session, id: string) {
  return withSession(session, (sql) => liquidacionDetalleSql(sql, id))
}

/** Aviso al propietario (si lo pidió). Devuelve si salió bien o no aplicaba. */
async function avisar(l: LiquidacionDetalle): Promise<boolean> {
  if (!l.propietario.avisos_estado_cuenta || !l.propietario.contacto_email) return true
  try {
    await sendEmail({ to: l.propietario.contacto_email, ...correoEstadoCuenta({ periodo: l.periodo, idioma: l.propietario.idioma }) })
    return true
  } catch (err) {
    console.error('No se pudo enviar el aviso de estado de cuenta', l.id, err)
    return false
  }
}

/**
 * Sólo admin. (1) cierra (se confirma); (2) PDF + documento reporte; (3) aviso por correo.
 * Si (2) o (3) fallan, la liquidación queda cerrada y se devuelve `advertencia`.
 */
export async function cerrarLiquidacion(id: string): Promise<Resultado> {
  const session = await requireRol('admin', 'equipo')
  if (session.rol !== 'admin') return fallo('_form', 'Sólo el administrador puede cerrar liquidaciones')
  if (!esUuid(id)) return fallo('_form', 'Liquidación inválida')
  const r = await ejecutar(() =>
    withSession(session, async (sql) => {
      await sql`select cerrar_liquidacion(${id})`
      return id
    }),
  )
  if (!r.ok) return r

  let l: LiquidacionDetalle | null = null
  let pdfOk = true
  try {
    l = await cargar(session, id)
    if (!l) throw new Error('Liquidación no encontrada después de cerrar')
    await generarPdf(session, l)
  } catch (err) {
    console.error('No se pudo generar el PDF de la liquidación', id, err)
    pdfOk = false
  }
  const avisoOk = l ? await avisar(l) : false
  if (!pdfOk) return { ...r, advertencia: 'La liquidación se cerró pero no se pudo generar el PDF; usa "Regenerar PDF"' }
  if (!avisoOk) return { ...r, advertencia: 'La liquidación se cerró pero no se pudo enviar el aviso al propietario' }
  return r
}

/** Vuelve a generar el PDF de una liquidación cerrada o pagada. */
export async function regenerarPdfLiquidacion(id: string): Promise<Resultado> {
  const session = await requireRol('admin', 'equipo')
  if (!esUuid(id)) return fallo('_form', 'Liquidación inválida')
  const l = await cargar(session, id)
  if (!l) return fallo('_form', 'La liquidación no existe')
  if (l.estatus === 'borrador') return fallo('_form', 'La liquidación no está en el estado correcto para esta acción')
  try {
    await generarPdf(session, l)
    return { ok: true, id }
  } catch (err) {
    console.error('No se pudo regenerar el PDF de la liquidación', id, err)
    return fallo('_form', 'No se pudo generar el PDF. Intenta de nuevo.')
  }
}

/** Registra el pago de una liquidación cerrada. El comprobante se sube antes: si falla, nada cambia. */
export async function pagarLiquidacion(id: string, formData: FormData): Promise<Resultado> {
  const session = await requireRol('admin', 'equipo')
  if (!esUuid(id)) return fallo('_form', 'Liquidación inválida')
  const v = validar(pagoLiquidacionSchema, formData)
  const comp = await leerComprobante(formData, 'comprobante')
  if (!v.ok || !comp.ok) return { ok: false, errores: { ...(v.ok ? {} : v.errores), ...(comp.ok ? {} : comp.errores) } }
  const l = await cargar(session, id)
  if (!l) return fallo('_form', 'La liquidación no existe')
  if (l.estatus !== 'cerrada') return fallo('_form', 'La liquidación no está en el estado correcto para esta acción')

  let path: string | null = null
  if (comp.data) {
    path = `propietarios/${l.propietario_id}/liquidaciones/${l.periodo}-pago.${comp.data.ext}`
    try {
      await putFile(path, comp.data.data, comp.data.contentType)
    } catch (err) {
      console.error('No se pudo subir el comprobante del pago de la liquidación', id, err)
      return fallo('comprobante', 'No se pudo guardar el comprobante. Intenta de nuevo.')
    }
  }
  return ejecutar(() =>
    withSession(session, async (sql) => {
      await sql`select pagar_liquidacion(${id}, ${v.data.fecha}::date, ${v.data.referencia}, ${path})`
      return id
    }),
  )
}

/** Sólo admin: corrección manual que entra como ajuste en la siguiente liquidación del propietario. */
export async function registrarAjuste(propietarioId: string, monto: string, descripcion: string): Promise<Resultado> {
  const session = await requireRol('admin')
  if (!esUuid(propietarioId)) return fallo('_form', 'Propietario inválido')
  const v = validar(ajusteSchema, { monto, descripcion })
  if (!v.ok) return v
  return ejecutar(() =>
    withSession(session, async (sql) => {
      const [{ id }] = await sql<{ id: string }[]>`
        select registrar_ajuste(${propietarioId}, ${v.data.monto}, ${v.data.descripcion}) as id`
      return id
    }),
  )
}
