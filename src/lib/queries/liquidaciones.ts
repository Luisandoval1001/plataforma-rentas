import type { Session } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import type { Sql } from './tipos'

const PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 'YYYY-MM' válido → 'YYYY-MM-01'; si no, null. */
function primerDia(periodo: string | undefined): string | null {
  return periodo && PERIODO.test(periodo) ? `${periodo}-01` : null
}

const uuidONull = (v: string | undefined) => (v && UUID.test(v) ? v : null)

export type Estatus = 'borrador' | 'cerrada' | 'pagada'

export type ResumenFila = {
  propietario_id: string
  propietario_nombre: string
  modelo: 'cobra_disa' | 'cobra_propietario'
  liquidacion_id: string | null
  estatus: Estatus | null
  neto: string | null
  pdf_path: string | null
}

/** Un renglón por propietario activo con su liquidación del periodo (si existe; por omisión, el mes anterior). */
export function liquidacionesResumen(session: Session, f: { periodo?: string }): Promise<ResumenFila[]> {
  return withSession(session, async (sql) => [
    ...(await sql<ResumenFila[]>`
      select p.id as propietario_id, p.nombre as propietario_nombre, p.modelo,
             l.id as liquidacion_id, l.estatus, l.neto, l.pdf_path
      from propietarios p
      left join liquidaciones l on l.propietario_id = p.id
        and l.periodo = coalesce(${primerDia(f.periodo)}::date, (date_trunc('month', current_date) - interval '1 month')::date)
      where p.activo
      order by p.nombre`),
  ])
}

export type Linea = { id: string; tipo: string; descripcion: string; monto: string }

export type LiquidacionDetalle = {
  id: string
  propietario_id: string
  periodo: string // 'YYYY-MM'
  estatus: Estatus
  modelo: 'cobra_disa' | 'cobra_propietario'
  comision_pct: string
  cobrado: string
  cobrado_disa: string
  comision: string
  iva: string
  gastos_disa: string
  gastos_propietario: string
  ajustes: string
  neto: string
  cerrada_at: Date | null
  pagada_at: Date | null
  pago_fecha: Date | null
  pago_referencia: string | null
  pago_comprobante_path: string | null
  pdf_path: string | null
  lineas: Linea[]
  propietario: {
    nombre: string
    rfc: string | null
    idioma: 'es' | 'en'
    contacto_email: string | null
    avisos_estado_cuenta: boolean
  }
}

export async function liquidacionDetalleSql(sql: Sql, id: string): Promise<LiquidacionDetalle | null> {
  if (!UUID.test(id)) return null
  const [l] = await sql<(Omit<LiquidacionDetalle, 'lineas' | 'propietario'> & LiquidacionDetalle['propietario'])[]>`
    select l.id, l.propietario_id, to_char(l.periodo, 'YYYY-MM') as periodo, l.estatus, l.modelo, l.comision_pct,
           l.cobrado, l.cobrado_disa, l.comision, l.iva, l.gastos_disa, l.gastos_propietario, l.ajustes, l.neto,
           l.cerrada_at, l.pagada_at, l.pago_fecha, l.pago_referencia, l.pago_comprobante_path, l.pdf_path,
           p.nombre, p.rfc, p.idioma, p.contacto_email, p.avisos_estado_cuenta
    from liquidaciones l join propietarios p on p.id = l.propietario_id
    where l.id = ${id}`
  if (!l) return null
  const lineas = await sql<Linea[]>`
    select id, tipo, descripcion, monto from liquidacion_lineas
    where liquidacion_id = ${id} order by tipo, descripcion`
  const { nombre, rfc, idioma, contacto_email, avisos_estado_cuenta, ...resto } = l
  return { ...resto, lineas: [...lineas], propietario: { nombre, rfc, idioma, contacto_email, avisos_estado_cuenta } }
}

export function liquidacionDetalle(session: Session, id: string) {
  return withSession(session, (sql) => liquidacionDetalleSql(sql, id))
}

export type GastoFila = {
  id: string
  fecha: Date
  concepto: string
  monto: string
  pagado_por: 'disa' | 'propietario'
  autorizado_por: string | null
  comprobante_path: string | null
  inmueble_id: string
  inmueble_nombre: string
  unidad_nombre: string | null
  propietario_id: string
  propietario_nombre: string
}

export type FiltrosGastos = { inmuebleId?: string; propietarioId?: string; periodo?: string }

/** Gastos, del más reciente al más antiguo; `periodo` 'YYYY-MM' filtra por mes de la fecha. */
export function gastosLista(session: Session, f: FiltrosGastos): Promise<GastoFila[]> {
  const inmueble = uuidONull(f.inmuebleId)
  const propietario = uuidONull(f.propietarioId)
  const periodo = primerDia(f.periodo)
  return withSession(session, async (sql) => [
    ...(await sql<GastoFila[]>`
      select g.id, g.fecha, g.concepto, g.monto, g.pagado_por, g.autorizado_por, g.comprobante_path,
             g.inmueble_id, i.nombre as inmueble_nombre, un.nombre as unidad_nombre,
             g.propietario_id, p.nombre as propietario_nombre
      from gastos g
      join inmuebles i on i.id = g.inmueble_id
      left join unidades un on un.id = g.unidad_id
      join propietarios p on p.id = g.propietario_id
      where (${inmueble}::uuid is null or g.inmueble_id = ${inmueble}::uuid)
        and (${propietario}::uuid is null or g.propietario_id = ${propietario}::uuid)
        and (${periodo}::date is null
             or (g.fecha >= ${periodo}::date and g.fecha < (${periodo}::date + interval '1 month')))
      order by g.fecha desc, g.created_at desc`),
  ])
}

export type DocumentoFila = {
  id: string
  tipo: 'factura' | 'reporte' | 'contrato' | 'comprobante' | 'otro'
  nombre: string
  path: string
  unidad_nombre: string | null
  liquidacion_id: string | null
  visible_propietario: boolean
  created_at: Date
}

/** Documentos del propietario (opcionalmente sólo los de una liquidación), más recientes primero. */
export function documentosDePropietario(
  session: Session,
  propietarioId: string,
  f: { liquidacionId?: string } = {},
): Promise<DocumentoFila[]> {
  if (!UUID.test(propietarioId)) return Promise.resolve([])
  const liquidacion = uuidONull(f.liquidacionId)
  return withSession(session, async (sql) => [
    ...(await sql<DocumentoFila[]>`
      select d.id, d.tipo, d.nombre, d.path, un.nombre as unidad_nombre, d.liquidacion_id,
             d.visible_propietario, d.created_at
      from documentos d left join unidades un on un.id = d.unidad_id
      where d.propietario_id = ${propietarioId}
        and (${liquidacion}::uuid is null or d.liquidacion_id = ${liquidacion}::uuid)
      order by d.created_at desc, d.nombre, d.path`),
  ])
}

/** Un gasto, con su unidad (para el formulario de edición). */
export async function obtenerGasto(session: Session, id: string) {
  if (!UUID.test(id)) return null
  const [g] = await withSession(session, (sql) => sql<(GastoFila & { unidad_id: string | null })[]>`
    select g.id, g.fecha, g.concepto, g.monto, g.pagado_por, g.autorizado_por, g.comprobante_path,
           g.inmueble_id, i.nombre as inmueble_nombre, g.unidad_id, null as unidad_nombre,
           g.propietario_id, p.nombre as propietario_nombre
    from gastos g join inmuebles i on i.id = g.inmueble_id join propietarios p on p.id = g.propietario_id
    where g.id = ${id}`)
  return g ?? null
}
