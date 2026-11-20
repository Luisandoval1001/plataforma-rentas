import type { Sql } from './tipos'

export type InmuebleFila = {
  id: string
  nombre: string
  direccion: string | null
  tipo: string
  propietario_nombre: string
  cobrador_nombre: string | null
  unidades: number
}

export type Inmueble = {
  id: string
  nombre: string
  direccion: string | null
  tipo: string
  propietario_id: string
  propietario_nombre: string
  cobrador_id: string | null
  cobrador_nombre: string | null
}

export type UnidadConContrato = {
  id: string
  nombre: string
  contrato_id: string | null
  inquilino_nombre: string | null
  renta_mensual: string | null
  estatus_calc: string | null
  pendiente_firma_desde: Date | null
}

export function listarInmuebles(sql: Sql) {
  return sql<InmuebleFila[]>`
    select i.id, i.nombre, i.direccion, i.tipo, p.nombre as propietario_nombre,
           u.nombre as cobrador_nombre,
           (select count(*)::int from unidades un where un.inmueble_id = i.id) as unidades
    from inmuebles i
    join propietarios p on p.id = i.propietario_id
    left join usuarios u on u.id = i.cobrador_id
    order by i.nombre`
}

export async function obtenerInmueble(sql: Sql, id: string): Promise<Inmueble | null> {
  const [i] = await sql<Inmueble[]>`
    select i.id, i.nombre, i.direccion, i.tipo, i.propietario_id, p.nombre as propietario_nombre,
           i.cobrador_id, u.nombre as cobrador_nombre
    from inmuebles i
    join propietarios p on p.id = i.propietario_id
    left join usuarios u on u.id = i.cobrador_id
    where i.id = ${id}`
  return i ?? null
}

/** Unidades del inmueble con su contrato actual (el vigente o, si no hay, el pendiente de firma más reciente). */
export function unidadesConContrato(sql: Sql, inmuebleId: string) {
  return sql<UnidadConContrato[]>`
    select un.id, un.nombre, c.id as contrato_id, c.inquilino_nombre, c.renta_actual as renta_mensual,
           c.estatus_calc, c.pendiente_firma_desde
    from unidades un
    left join lateral (
      select vc.* from v_contratos vc
      where vc.unidad_id = un.id and vc.estatus <> 'terminado'
      order by (vc.estatus = 'vigente') desc, vc.fecha_inicio desc
      limit 1
    ) c on true
    where un.inmueble_id = ${inmuebleId}
    order by un.nombre`
}

/** Usuarios que pueden ser cobradores: admin y equipo activos. */
export function cobradores(sql: Sql) {
  return sql<{ id: string; nombre: string }[]>`
    select id, nombre from usuarios where rol in ('admin', 'equipo') and activo order by nombre`
}
