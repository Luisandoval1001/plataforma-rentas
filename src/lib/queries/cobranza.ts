import type { Session } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import type { Sql } from './tipos'

export const ESTATUS_CARGO = ['pendiente', 'parcial', 'vencido', 'pagado'] as const
export type EstatusCargo = (typeof ESTATUS_CARGO)[number]

const PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/

export type PagoAplicado = {
  id: string
  fecha: Date
  monto_aplicado: string
  monto: string
  metodo: string | null
  referencia: string
  cancelado: boolean
  cancelado_motivo: string | null
}

export type CargoFila = {
  id: string
  tipo: string
  periodo: Date
  monto: string
  pagado: string
  saldo: string
  estatus: EstatusCargo
  dias_atraso: number
  fecha_limite: Date
  notas: string | null
  propietario_id: string
  contrato_id: string
  inmueble_nombre: string
  unidad_nombre: string
  inquilino_nombre: string
  propietario_nombre: string
  /** Modelo de dinero del propietario: decide la cuenta destino por omisión al registrar el pago. */
  propietario_modelo: 'cobra_disa' | 'cobra_propietario'
  pagos: PagoAplicado[]
}

/**
 * `periodo` 'YYYY-MM' (por defecto el mes en curso). `cobradorId`: undefined → el usuario actual
 * si cobra al menos un inmueble; null → todos.
 */
export type FiltrosCobranza = {
  periodo?: string
  inmuebleId?: string
  propietarioId?: string
  estatus?: EstatusCargo
  cobradorId?: string | null
}

/** Cobrador por defecto: el usuario, si tiene inmuebles asignados. */
export async function cobradorPorDefecto(sql: Sql, usuarioId: string): Promise<string | null> {
  const [r] = await sql`select 1 from inmuebles where cobrador_id = ${usuarioId} limit 1`
  return r ? usuarioId : null
}

async function pagosDe(sql: Sql, cargoIds: string[]) {
  if (cargoIds.length === 0) return new Map<string, PagoAplicado[]>()
  const filas = await sql<(PagoAplicado & { cargo_id: string })[]>`
    select pa.cargo_id, p.id, p.fecha, pa.monto as monto_aplicado, p.monto, p.metodo, p.referencia,
           p.cancelado, p.cancelado_motivo
    from pago_aplicaciones pa join pagos p on p.id = pa.pago_id
    where pa.cargo_id = any (${cargoIds}::uuid[])
    order by p.fecha, p.created_at`
  const porCargo = new Map<string, PagoAplicado[]>()
  for (const { cargo_id, ...p } of filas) porCargo.set(cargo_id, [...(porCargo.get(cargo_id) ?? []), p])
  return porCargo
}

export async function cargosDelMesSql(sql: Sql, usuarioId: string, f: FiltrosCobranza): Promise<CargoFila[]> {
  const cobrador = f.cobradorId === undefined ? await cobradorPorDefecto(sql, usuarioId) : f.cobradorId
  const periodo = f.periodo && PERIODO.test(f.periodo) ? `${f.periodo}-01` : null
  const filas = await sql<Omit<CargoFila, 'pagos'>[]>`
    select c.id, c.tipo, c.periodo, c.monto, c.pagado, c.saldo, c.estatus, c.dias_atraso, c.fecha_limite,
           c.notas, c.propietario_id, c.contrato_id, i.nombre as inmueble_nombre, un.nombre as unidad_nombre,
           q.nombre as inquilino_nombre, p.nombre as propietario_nombre, p.modelo as propietario_modelo
    from v_cargos c
    join contratos ct on ct.id = c.contrato_id
    join unidades un on un.id = ct.unidad_id
    join inmuebles i on i.id = un.inmueble_id
    join inquilinos q on q.id = ct.inquilino_id
    join propietarios p on p.id = c.propietario_id
    where c.periodo = coalesce(${periodo}::date, date_trunc('month', current_date)::date)
      and (${f.inmuebleId ?? null}::uuid is null or i.id = ${f.inmuebleId ?? null}::uuid)
      and (${f.propietarioId ?? null}::uuid is null or c.propietario_id = ${f.propietarioId ?? null}::uuid)
      and (${f.estatus ?? null}::text is null or c.estatus = ${f.estatus ?? null}::text)
      and (${cobrador}::uuid is null or i.cobrador_id = ${cobrador}::uuid)
    order by i.nombre, un.nombre, c.tipo, c.fecha_limite`
  const pagos = await pagosDe(sql, filas.map((c) => c.id))
  return filas.map((c) => ({ ...c, pagos: pagos.get(c.id) ?? [] }))
}

export function cargosDelMes(session: Session, filtros: FiltrosCobranza): Promise<CargoFila[]> {
  return withSession(session, (sql) => cargosDelMesSql(sql, session.usuarioId, filtros))
}

export type Opcion = { id: string; nombre: string }

/** Opciones de los filtros de cobranza y el cobrador por defecto del usuario. */
export function opcionesCobranza(session: Session) {
  return withSession(session, async (sql) => {
    const [inmuebles, propietarios, cobradores, porDefecto] = await Promise.all([
      sql<Opcion[]>`select id, nombre from inmuebles order by nombre`,
      sql<Opcion[]>`select id, nombre from propietarios where activo order by nombre`,
      sql<Opcion[]>`select distinct u.id, u.nombre from usuarios u
                    join inmuebles i on i.cobrador_id = u.id order by u.nombre`,
      cobradorPorDefecto(sql, session.usuarioId),
    ])
    return { inmuebles: [...inmuebles], propietarios: [...propietarios], cobradores: [...cobradores], porDefecto }
  })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Filtros desde la URL (`?periodo=&inmueble=&propietario=&estatus=&cobrador=`); valores inválidos se ignoran. */
export function filtrosDesdeUrl(q: Record<string, string | string[] | undefined>): FiltrosCobranza {
  const uno = (k: string) => {
    const v = q[k]
    return typeof v === 'string' && v !== '' ? v : undefined
  }
  const uuid = (k: string) => {
    const v = uno(k)
    return v && UUID.test(v) ? v : undefined
  }
  const periodo = uno('periodo')
  const estatus = uno('estatus')
  const cobrador = uno('cobrador')
  return {
    periodo: periodo && PERIODO.test(periodo) ? periodo : undefined,
    inmuebleId: uuid('inmueble'),
    propietarioId: uuid('propietario'),
    estatus: ESTATUS_CARGO.find((e) => e === estatus),
    cobradorId: cobrador === 'todos' ? null : uuid('cobrador'),
  }
}
