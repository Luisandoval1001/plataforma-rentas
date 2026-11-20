import type { Session } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import type { Idioma } from '@/lib/i18n'

// Portal del propietario: sólo lee las vistas portal_* (0004), que ya filtran por rol
// 'propietario' y por los propietarios del usuario. Para cualquier otro rol devuelven vacío.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type PortalPropietario = {
  id: string
  nombre: string
  idioma: Idioma
  modelo: 'cobra_disa' | 'cobra_propietario'
  comision_pct: string
}

export type EstatusCargo = 'pagado' | 'pendiente' | 'parcial' | 'vencido'

export type PortalCargo = {
  cargo_id: string
  tipo: 'renta' | 'recargo' | 'otro'
  monto: string
  fecha_limite: Date
  pagado: string
  saldo: string
  estatus: EstatusCargo
  dias_atraso: number
  ultimo_pago_fecha: Date | null
}

export type PortalUnidad = {
  unidad_id: string
  unidad_nombre: string
  inmueble_nombre: string
  inquilino_nombre: string | null
  cargos: PortalCargo[]
}

export type Totales = { esperado: number; cobrado: number; pendiente: number; vencido: number }

export type PortalResumen = { propietario: PortalPropietario; totales: Totales; unidades: PortalUnidad[] }

export function portalPropietarios(session: Session): Promise<PortalPropietario[]> {
  return withSession(session, async (sql) => [
    ...(await sql<PortalPropietario[]>`
      select id, nombre, idioma, modelo, comision_pct from portal_propietario order by nombre, id`),
  ])
}

type FilaResumen = Omit<PortalUnidad, 'cargos'> &
  { propietario_id: string } & { [K in keyof PortalCargo]: PortalCargo[K] | null }

const centavos = (v: string | null) => Math.round(Number(v ?? 0) * 100)

/** Totales del mes: esperado = Σ monto, cobrado = Σ pagado, pendiente/vencido = Σ saldo por estatus. */
function totalizar(cargos: PortalCargo[]): Totales {
  const c = { esperado: 0, cobrado: 0, pendiente: 0, vencido: 0 }
  for (const x of cargos) {
    c.esperado += centavos(x.monto)
    c.cobrado += centavos(x.pagado)
    if (x.estatus === 'vencido') c.vencido += centavos(x.saldo)
    else if (x.estatus !== 'pagado') c.pendiente += centavos(x.saldo)
  }
  return { esperado: c.esperado / 100, cobrado: c.cobrado / 100, pendiente: c.pendiente / 100, vencido: c.vencido / 100 }
}

/** Por propietario del usuario: totales del mes en curso y unidades con sus cargos del mes. */
export async function portalResumen(session: Session): Promise<PortalResumen[]> {
  const [propietarios, filas] = await withSession(session, async (sql) => [
    await sql<PortalPropietario[]>`
      select id, nombre, idioma, modelo, comision_pct from portal_propietario order by nombre, id`,
    await sql<FilaResumen[]>`
      select propietario_id, unidad_id, unidad_nombre, inmueble_nombre, inquilino_nombre, cargo_id, tipo,
             monto, fecha_limite, pagado, saldo, estatus, dias_atraso, ultimo_pago_fecha
      from portal_resumen_unidades
      order by inmueble_nombre, unidad_nombre, unidad_id, fecha_limite, tipo, cargo_id`,
  ] as const)
  return propietarios.map((propietario) => {
    const unidades = new Map<string, PortalUnidad>()
    for (const f of filas.filter((x) => x.propietario_id === propietario.id)) {
      const u = unidades.get(f.unidad_id) ?? {
        unidad_id: f.unidad_id,
        unidad_nombre: f.unidad_nombre,
        inmueble_nombre: f.inmueble_nombre,
        inquilino_nombre: f.inquilino_nombre,
        cargos: [],
      }
      unidades.set(f.unidad_id, u)
      if (f.cargo_id) u.cargos.push(f as PortalCargo)
    }
    const lista = [...unidades.values()]
    return { propietario, totales: totalizar(lista.flatMap((u) => u.cargos)), unidades: lista }
  })
}

export type PortalLiquidacion = {
  id: string
  propietario_id: string
  periodo: string // 'YYYY-MM'
  estatus: 'cerrada' | 'pagada'
  cobrado: string
  cobrado_disa: string
  comision: string
  iva: string
  gastos_disa: string
  gastos_propietario: string
  ajustes: string
  neto: string
  pago_fecha: Date | null
  pdf_path: string | null
}

/** Liquidaciones cerradas o pagadas, de la más reciente a la más antigua. */
export function portalLiquidaciones(session: Session): Promise<PortalLiquidacion[]> {
  return withSession(session, async (sql) => [
    ...(await sql<PortalLiquidacion[]>`
      select id, propietario_id, to_char(periodo, 'YYYY-MM') as periodo, estatus, cobrado, cobrado_disa, comision, iva,
             gastos_disa, gastos_propietario, ajustes, neto, pago_fecha, pdf_path
      from portal_liquidaciones order by periodo desc, propietario_id`),
  ])
}

export type PortalDocumento = {
  id: string
  propietario_id: string
  tipo: 'factura' | 'reporte' | 'contrato' | 'comprobante' | 'otro'
  nombre: string
  path: string
  liquidacion_id: string | null
  /** Día de alta en hora de la Ciudad de México. */
  fecha: Date
}

export type PortalLiquidacionDetalle = PortalLiquidacion & {
  lineas: {
    tipo: 'cobro' | 'gasto_disa' | 'gasto_propietario' | 'ajuste'
    descripcion: string
    monto: string
    /** Comprobante del gasto (sólo líneas de gasto). */
    comprobante_path: string | null
  }[]
  documentos: PortalDocumento[]
}

/** Una liquidación cerrada/pagada del usuario con sus líneas y documentos; null si no la ve. */
export async function portalLiquidacion(session: Session, id: string): Promise<PortalLiquidacionDetalle | null> {
  if (!UUID.test(id)) return null
  return withSession(session, async (sql) => {
    const [l] = await sql<PortalLiquidacion[]>`
      select id, propietario_id, to_char(periodo, 'YYYY-MM') as periodo, estatus, cobrado, cobrado_disa, comision, iva,
             gastos_disa, gastos_propietario, ajustes, neto, pago_fecha, pdf_path
      from portal_liquidaciones where id = ${id}`
    if (!l) return null
    const lineas = await sql<PortalLiquidacionDetalle['lineas']>`
      select tipo, descripcion, monto, comprobante_path from portal_liquidacion_lineas
      where liquidacion_id = ${id} order by tipo, descripcion`
    const documentos = await sql<PortalDocumento[]>`
      select id, propietario_id, tipo, nombre, path, liquidacion_id,
             (created_at at time zone 'America/Mexico_City')::date as fecha
      from portal_documentos where liquidacion_id = ${id} order by created_at desc, nombre`
    return { ...l, lineas: [...lineas], documentos: [...documentos] }
  })
}

export type PortalContrato = {
  propietario_id: string
  contrato_id: string
  unidad_nombre: string
  inmueble_nombre: string
  inquilino_nombre: string | null
  fecha_inicio: Date
  fecha_fin: Date
  renta_mensual: string
  renta_actual: string
  deposito: string | null
  estatus_calc: 'vigente' | 'por_vencer' | 'vencido' | 'terminado' | 'pendiente_firma'
  pdf_path: string | null
}

/** Contratos del usuario por inmueble y unidad (el más reciente primero dentro de la unidad). */
export function portalContratos(session: Session): Promise<PortalContrato[]> {
  return withSession(session, async (sql) => [
    ...(await sql<PortalContrato[]>`
      select propietario_id, contrato_id, unidad_nombre, inmueble_nombre, inquilino_nombre, fecha_inicio,
             fecha_fin, renta_mensual, renta_actual, deposito, estatus_calc, pdf_path
      from portal_contratos order by inmueble_nombre, unidad_nombre, fecha_inicio desc, contrato_id`),
  ])
}

/** Documentos visibles para el propietario, más recientes primero. */
export function portalDocumentos(session: Session): Promise<PortalDocumento[]> {
  return withSession(session, async (sql) => [
    ...(await sql<PortalDocumento[]>`
      select id, propietario_id, tipo, nombre, path, liquidacion_id, (created_at at time zone 'America/Mexico_City')::date as fecha
      from portal_documentos order by created_at desc, nombre, id`),
  ])
}
