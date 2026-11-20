import { ErrorNegocio } from '@/lib/acciones'
import type { Sql } from './tipos'

export type ContratoFila = {
  id: string
  inmueble_nombre: string
  unidad_nombre: string
  inquilino_nombre: string
  propietario_nombre: string
  fecha_inicio: Date
  fecha_fin: Date
  renta_mensual: string
  /** Renta con el incremento anual de los años cumplidos (app.renta_vigente). */
  renta_actual: string
  estatus_calc: string
  pendiente_firma_desde: Date | null
}

export type Contrato = ContratoFila & {
  estatus: 'pendiente_firma' | 'vigente' | 'terminado'
  unidad_id: string
  inmueble_id: string
  propietario_id: string
  dia_pago: number
  deposito: string
  incremento_anual_pct: string
  cargos_desde: Date
  pdf_path: string | null
  contrato_origen_id: string | null
  /** Renovación no terminada (misma regla que renovarContrato). */
  renovacion_id: string | null
}

export function listarContratos(sql: Sql) {
  return sql<ContratoFila[]>`
    select c.id, i.nombre as inmueble_nombre, un.nombre as unidad_nombre, c.inquilino_nombre,
           p.nombre as propietario_nombre, c.fecha_inicio, c.fecha_fin, c.renta_mensual, c.renta_actual,
           c.estatus_calc, c.pendiente_firma_desde
    from v_contratos c
    join unidades un on un.id = c.unidad_id
    join inmuebles i on i.id = un.inmueble_id
    join propietarios p on p.id = c.propietario_id
    order by (c.estatus = 'terminado'), c.fecha_fin, i.nombre, un.nombre`
}

export async function obtenerContrato(sql: Sql, id: string): Promise<Contrato | null> {
  const [c] = await sql<Contrato[]>`
    select c.id, c.estatus, c.estatus_calc, c.unidad_id, un.inmueble_id, c.propietario_id,
           i.nombre as inmueble_nombre, un.nombre as unidad_nombre, c.inquilino_nombre,
           p.nombre as propietario_nombre, c.fecha_inicio, c.fecha_fin, c.renta_mensual, c.renta_actual,
           c.dia_pago, c.deposito, c.incremento_anual_pct, c.cargos_desde, c.pdf_path, c.pendiente_firma_desde,
           c.contrato_origen_id,
           (select r.id from contratos r
            where r.contrato_origen_id = c.id and r.estatus <> 'terminado'
            order by r.created_at desc limit 1) as renovacion_id
    from v_contratos c
    join unidades un on un.id = c.unidad_id
    join inmuebles i on i.id = un.inmueble_id
    join propietarios p on p.id = c.propietario_id
    where c.id = ${id}`
  return c ?? null
}

/** Datos para el selector propietario → inmueble → unidad del alta. */
export async function opcionesUnidades(sql: Sql) {
  const [inmuebles, unidades] = await Promise.all([
    sql<{ id: string; nombre: string; propietario_id: string }[]>`
      select id, nombre, propietario_id from inmuebles order by nombre`,
    sql<{ id: string; nombre: string; inmueble_id: string }[]>`
      select id, nombre, inmueble_id from unidades order by nombre`,
  ])
  return { inmuebles: [...inmuebles], unidades: [...unidades] }
}

/**
 * Regla de negocio: a lo más un contrato `vigente` por unidad. Bloquea la unidad para que dos
 * altas simultáneas no pasen ambas la verificación. `excluirId` = contrato que se termina en la
 * misma transacción (renovación que se activa).
 */
export async function asegurarSinVigente(sql: Sql, unidadId: string, excluirId: string | null = null) {
  const [u] = await sql<{ id: string }[]>`select id from unidades where id = ${unidadId} for update`
  if (!u) throw new ErrorNegocio('unidad_id', 'La unidad no existe')
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from contratos
    where unidad_id = ${unidadId} and estatus = 'vigente'
      and (${excluirId}::uuid is null or id <> ${excluirId}::uuid)`
  if (n > 0) throw new ErrorNegocio('unidad_id', 'La unidad ya tiene un contrato vigente')
}

export function rutaPdfContrato(propietarioId: string, contratoId: string) {
  return `propietarios/${propietarioId}/contratos/${contratoId}.pdf`
}
