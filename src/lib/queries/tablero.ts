import type { Session } from '@/lib/auth/session'
import { withSession } from '@/lib/db'

export type Vencido = {
  id: string
  periodo: Date
  inmueble_nombre: string
  unidad_nombre: string
  inquilino_nombre: string
  dias_atraso: number
  saldo: string
}

export type PagoHoy = {
  id: string
  monto: string
  referencia: string
  metodo: string | null
  lugares: string
  propietario_nombre: string
}

export type ContratoPorVencer = {
  id: string
  inmueble_nombre: string
  unidad_nombre: string
  inquilino_nombre: string
  fecha_fin: Date
}

export type LiquidacionPendiente = { propietario_id: string; nombre: string; estatus: 'borrador' | null }

/**
 * Tablero del día: vencidos, pagos de hoy, contratos por vencer (sin los ya renovados) y liquidaciones
 * del mes ANTERIOR sin cerrar (el mes en curso no se puede cerrar hasta que termine).
 */
export function tablero(session: Session) {
  return withSession(session, async (sql) => {
    const [vencidos, pagosHoy, contratosPorVencer, liquidacionesPendientes] = await Promise.all([
      sql<Vencido[]>`
        select c.id, c.periodo, i.nombre as inmueble_nombre, un.nombre as unidad_nombre,
               q.nombre as inquilino_nombre, c.dias_atraso, c.saldo
        from v_cargos c
        join contratos ct on ct.id = c.contrato_id
        join unidades un on un.id = ct.unidad_id
        join inmuebles i on i.id = un.inmueble_id
        join inquilinos q on q.id = ct.inquilino_id
        where c.estatus = 'vencido'
        order by c.dias_atraso desc, i.nombre, un.nombre`,
      sql<PagoHoy[]>`
        select p.id, p.monto, p.referencia, p.metodo, pr.nombre as propietario_nombre,
               (select string_agg(distinct i.nombre || ' · ' || un.nombre, ', ')
                from pago_aplicaciones pa
                join cargos c on c.id = pa.cargo_id
                join contratos ct on ct.id = c.contrato_id
                join unidades un on un.id = ct.unidad_id
                join inmuebles i on i.id = un.inmueble_id
                where pa.pago_id = p.id) as lugares
        from pagos p join propietarios pr on pr.id = p.propietario_id
        where p.fecha = current_date and not p.cancelado
        order by p.created_at`,
      sql<ContratoPorVencer[]>`
        select c.id, i.nombre as inmueble_nombre, un.nombre as unidad_nombre, c.inquilino_nombre, c.fecha_fin
        from v_contratos c
        join unidades un on un.id = c.unidad_id
        join inmuebles i on i.id = un.inmueble_id
        where c.estatus_calc = 'por_vencer' and not c.tiene_sucesor_vigente
        order by c.fecha_fin, i.nombre, un.nombre`,
      sql<LiquidacionPendiente[]>`
        select p.id as propietario_id, p.nombre, l.estatus
        from propietarios p
        left join liquidaciones l
          on l.propietario_id = p.id
         and l.periodo = (date_trunc('month', current_date) - interval '1 month')::date
        where p.activo and (l.id is null or l.estatus = 'borrador')
        order by p.nombre`,
    ])
    return {
      vencidos: [...vencidos],
      pagosHoy: [...pagosHoy],
      contratosPorVencer: [...contratosPorVencer],
      liquidacionesPendientes: [...liquidacionesPendientes],
    }
  })
}
