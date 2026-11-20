import type { Sql } from './tipos'

export type PropietarioFila = {
  id: string
  nombre: string
  modelo: 'cobra_disa' | 'cobra_propietario'
  comision_pct: string
  activo: boolean
  inmuebles: number
}

export type Propietario = {
  id: string
  nombre: string
  rfc: string | null
  modelo: 'cobra_disa' | 'cobra_propietario'
  comision_pct: string
  cuenta_ultimos4: string | null
  recargo_visible: boolean
  recargos_al_propietario: boolean
  idioma: 'es' | 'en'
  avisos_pago: boolean
  avisos_estado_cuenta: boolean
  avisos_contrato: boolean
  contacto_email: string | null
  contacto_tel: string | null
  activo: boolean
}

export type UsuarioPortal = { id: string; nombre: string; email: string; activo: boolean }

export const MODELO_TEXTO = { cobra_disa: 'Cobra DISA', cobra_propietario: 'Cobra propietario' } as const

export function listarPropietarios(sql: Sql) {
  return sql<PropietarioFila[]>`
    select p.id, p.nombre, p.modelo, p.comision_pct, p.activo,
           (select count(*)::int from inmuebles i where i.propietario_id = p.id) as inmuebles
    from propietarios p
    order by p.nombre`
}

export async function obtenerPropietario(sql: Sql, id: string): Promise<Propietario | null> {
  const [p] = await sql<Propietario[]>`
    select id, nombre, rfc, modelo, comision_pct, cuenta_ultimos4, recargo_visible,
           recargos_al_propietario, idioma, avisos_pago, avisos_estado_cuenta, avisos_contrato,
           contacto_email, contacto_tel, activo
    from propietarios where id = ${id}`
  return p ?? null
}

export function usuariosPortal(sql: Sql, propietarioId: string) {
  return sql<UsuarioPortal[]>`
    select u.id, u.nombre, u.email, u.activo
    from propietario_usuarios pu join usuarios u on u.id = pu.usuario_id
    where pu.propietario_id = ${propietarioId}
    order by u.nombre`
}

export function opcionesPropietarios(sql: Sql) {
  return sql<{ id: string; nombre: string }[]>`
    select id, nombre from propietarios where activo order by nombre`
}
