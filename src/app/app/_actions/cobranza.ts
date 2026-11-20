'use server'

import { ejecutar, ErrorNegocio, esUuid, fallo, type Resultado } from '@/lib/acciones'
import { requireRol, type Session } from '@/lib/auth/session'
import { correoAvisoPago } from '@/lib/avisos'
import { withSession } from '@/lib/db'
import { sendEmail } from '@/lib/email'
import { putFile } from '@/lib/storage'
import { leerComprobante, type Comprobante } from '@/lib/validators/archivo'
import { textoOpcional, validar } from '@/lib/validators/comun'
import { montoPositivo, validarPago } from '@/lib/validators/pago'
import { z } from 'zod'

type Aviso = { to: string; lugar: string }

/** Envía el aviso fuera de la transacción: si el correo falla, el pago ya quedó registrado. */
async function avisar(aviso: Aviso | null, monto: number, fecha: string, referencia: string) {
  if (!aviso) return
  try {
    await sendEmail({ to: aviso.to, ...correoAvisoPago({ lugar: aviso.lugar, monto, fecha, referencia }) })
  } catch (err) {
    console.error('No se pudo enviar el aviso de pago', err)
  }
}

/**
 * Sube el comprobante y lo liga al pago ya registrado, en su propia transacción: no retiene los
 * bloqueos de registrar_pago durante la subida y, si falla, el pago se conserva. Devuelve si se guardó.
 */
async function guardarComprobante(session: Session, pagoId: string, propietarioId: string, c: Comprobante) {
  try {
    const path = `propietarios/${propietarioId}/pagos/${pagoId}.${c.ext}`
    await putFile(path, c.data, c.contentType)
    await withSession(session, (sql) => sql`select registrar_comprobante_pago(${pagoId}, ${path})`)
    return true
  } catch (err) {
    console.error('No se pudo guardar el comprobante del pago', pagoId, err)
    return false
  }
}

/**
 * Registra un pago sobre uno o más cargos del mismo propietario (registrar_pago), sube el
 * comprobante a `propietarios/<pid>/pagos/<pagoId>.<ext>` y avisa al propietario si lo pidió.
 */
export async function registrarPago(formData: FormData): Promise<Resultado> {
  const session = await requireRol('admin', 'equipo')
  const v = validarPago(formData)
  const comp = await leerComprobante(formData, 'comprobante')
  if (!v.ok || !comp.ok) return { ok: false, errores: { ...(v.ok ? {} : v.errores), ...(comp.ok ? {} : comp.errores) } }
  const d = v.data
  let aviso: Aviso | null = null
  let propietarioId = ''
  const r = await ejecutar(() =>
    withSession(session, async (sql) => {
      const [{ id }] = await sql<{ id: string }[]>`
        select registrar_pago(${d.cargoIds}::uuid[], ${d.monto}, ${d.fecha}, ${d.metodo},
                              ${d.referencia}, ${d.cuenta}, null) as id`
      const [p] = await sql<{ propietario_id: string; avisos_pago: boolean; contacto_email: string | null }[]>`
        select pg.propietario_id, pr.avisos_pago, pr.contacto_email
        from pagos pg join propietarios pr on pr.id = pg.propietario_id where pg.id = ${id}`
      propietarioId = p.propietario_id
      if (p.avisos_pago && p.contacto_email) {
        const [{ lugar }] = await sql<{ lugar: string }[]>`
          select string_agg(distinct i.nombre || ' ' || un.nombre, ', ') as lugar
          from cargos c
          join contratos ct on ct.id = c.contrato_id
          join unidades un on un.id = ct.unidad_id
          join inmuebles i on i.id = un.inmueble_id
          where c.id = any (${d.cargoIds}::uuid[])`
        aviso = { to: p.contacto_email, lugar }
      }
      return id
    }),
  )
  if (!r.ok) return r
  const advertencia = comp.data && !(await guardarComprobante(session, r.id, propietarioId, comp.data))
  await avisar(aviso, d.monto, d.fecha, d.referencia)
  return advertencia ? { ...r, advertencia: 'El pago se registró pero no se pudo guardar el comprobante' } : r
}

export async function cancelarPago(pagoId: string, motivo: string): Promise<Resultado> {
  const session = await requireRol('admin', 'equipo')
  if (!esUuid(pagoId)) return fallo('_form', 'Pago inválido')
  return ejecutar(() =>
    withSession(session, async (sql) => {
      await sql`select cancelar_pago(${pagoId}, ${String(motivo ?? '').slice(0, 500)})`
      return pagoId
    }),
  )
}

const notaSchema = z.object({ notas: textoOpcional(500) })

export async function actualizarNotaCargo(cargoId: string, notas: string): Promise<Resultado> {
  const session = await requireRol('admin', 'equipo')
  if (!esUuid(cargoId)) return fallo('_form', 'Cargo inválido')
  const v = validar(notaSchema, { notas })
  if (!v.ok) return v
  return ejecutar(() =>
    withSession(session, async (sql) => {
      const [r] = await sql<{ id: string }[]>`
        update cargos set notas = ${v.data.notas} where id = ${cargoId} returning id`
      if (!r) throw new ErrorNegocio('_form', 'El cargo no existe')
      return r.id
    }),
  )
}

const montoSchema = z.object({ monto: montoPositivo() })

export async function actualizarMontoCargo(cargoId: string, monto: string): Promise<Resultado> {
  const session = await requireRol('admin', 'equipo')
  if (!esUuid(cargoId)) return fallo('_form', 'Cargo inválido')
  const v = validar(montoSchema, { monto })
  if (!v.ok) return v
  return ejecutar(() =>
    withSession(session, async (sql) => {
      await sql`select actualizar_monto_cargo(${cargoId}, ${v.data.monto})`
      return cargoId
    }),
  )
}

/** Genera los cargos de renta del mes en curso. Éxito: `id` = número de cargos creados (texto). */
export async function generarCargosMes(): Promise<Resultado> {
  const session = await requireRol('admin')
  return ejecutar(() =>
    withSession(session, async (sql) => {
      const [{ n }] = await sql<{ n: number }[]>`
        select generar_cargos_renta(date_trunc('month', current_date)::date) as n`
      return String(n)
    }),
  )
}
