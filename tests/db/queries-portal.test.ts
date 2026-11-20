import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Session } from '@/lib/auth/types'
import { closeSql } from '@/lib/db'
import {
  portalContratos,
  portalDocumentos,
  portalLiquidacion,
  portalLiquidaciones,
  portalPropietarios,
  portalResumen,
} from '@/lib/queries/portal'
import { asUser, closeDb, resetDb, seedUsuarios, sqlAdmin } from './harness'

let ids: Awaited<ReturnType<typeof seedUsuarios>>
let propA: Session
let equipo: Session
let cerradaId: string
let borradorId: string

/** Unidad con contrato vigente en el inmueble dado; devuelve el contrato. */
async function unidadConContrato(inmuebleId: string, nombre: string, inquilino: string): Promise<string> {
  const [uni] = await sqlAdmin`insert into unidades (inmueble_id, nombre) values (${inmuebleId}, ${nombre}) returning id`
  const [inq] = await sqlAdmin`insert into inquilinos (nombre, email) values (${inquilino}, 'x@correo.mx') returning id`
  const [c] = await sqlAdmin`insert into contratos (unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago, deposito)
    values (${uni.id}, ${inq.id}, current_date - 90, current_date + 300, 10000, 5, 20000) returning id`
  return c.id
}

async function cargo(contratoId: string, monto: number, limiteEnDias: number, tipo = 'renta'): Promise<string> {
  const [c] = await sqlAdmin`insert into cargos (contrato_id, tipo, periodo, monto, fecha_limite)
    values (${contratoId}, ${tipo}, date_trunc('month', current_date)::date, ${monto}, current_date + ${limiteEnDias}::int)
    returning id`
  return c.id
}

function pagar(cargoId: string, monto: number) {
  return asUser(ids.equipo, (s) => s`select registrar_pago(${[cargoId]}::uuid[], ${monto}, current_date,
    'transferencia', ${`REF-${cargoId}`}, 'disa', null)`)
}

beforeAll(async () => {
  await resetDb()
  ids = await seedUsuarios()
  propA = { usuarioId: ids.propA, email: 'propa@local', rol: 'propietario', propietarioIds: [ids.propietarioA] }
  equipo = { usuarioId: ids.equipo, email: 'equipo@local', rol: 'equipo', propietarioIds: [] }

  const [inm] = await sqlAdmin`insert into inmuebles (propietario_id, nombre, tipo)
    values (${ids.propietarioA}, 'Torre', 'edificio') returning id`
  const pagado = await unidadConContrato(inm.id, '101', 'Inquilino Pagado')
  const parcial = await unidadConContrato(inm.id, '102', 'Inquilino Parcial')
  const vencido = await unidadConContrato(inm.id, '103', 'Inquilino Vencido')
  await sqlAdmin`insert into unidades (inmueble_id, nombre) values (${inm.id}, '104')`
  await pagar(await cargo(pagado, 10000, 5), 10000)
  await pagar(await cargo(parcial, 8000, 10), 3000)
  await cargo(vencido, 6000, -3)
  await cargo(vencido, 500, -3, 'recargo') // recargo_visible = false: no cuenta

  const [inmB] = await sqlAdmin`insert into inmuebles (propietario_id, nombre, tipo)
    values (${ids.propietarioB}, 'Casa B', 'casa') returning id`
  await cargo(await unidadConContrato(inmB.id, 'B-1', 'Inquilino B'), 7000, -1)

  const [b] = await sqlAdmin`insert into liquidaciones (propietario_id, periodo, modelo, comision_pct, cobrado, neto)
    values (${ids.propietarioA}, date_trunc('month', current_date - interval '3 month')::date, 'cobra_disa', 15, 1, 1)
    returning id`
  borradorId = b.id
  const [l] = await sqlAdmin`insert into liquidaciones (propietario_id, periodo, modelo, comision_pct,
      cobrado, cobrado_disa, comision, iva, gastos_disa, neto, pdf_path)
    values (${ids.propietarioA}, date_trunc('month', current_date - interval '2 month')::date, 'cobra_disa', 15,
      10000, 10000, 1500, 240, 1000, 7260, ${`propietarios/${ids.propietarioA}/liquidaciones/x.pdf`}) returning id`
  cerradaId = l.id
  const [g] = await sqlAdmin`insert into gastos (inmueble_id, fecha, concepto, monto, pagado_por, comprobante_path)
    values (${inm.id}, current_date - 70, 'Plomería', 1000, 'disa', ${`propietarios/${ids.propietarioA}/gastos/g.pdf`})
    returning id`
  await sqlAdmin`insert into liquidacion_lineas (liquidacion_id, tipo, referencia_id, descripcion, monto) values
    (${l.id}, 'gasto_disa', ${g.id}, 'Plomería', 1000), (${l.id}, 'cobro', null, 'Renta 101', 10000)`
  await sqlAdmin`update liquidaciones set estatus = 'cerrada', cerrada_at = now() where id = ${l.id}`
  await sqlAdmin`insert into documentos (propietario_id, tipo, nombre, path, liquidacion_id) values
    (${ids.propietarioA}, 'factura', 'Factura visible', 'propietarios/a/f.pdf', ${l.id})`
  await sqlAdmin`insert into documentos (propietario_id, tipo, nombre, path, visible_propietario) values
    (${ids.propietarioA}, 'otro', 'Documento interno', 'propietarios/a/i.pdf', false)`
})

afterAll(async () => {
  await closeSql()
  await closeDb()
})

describe('consultas del portal del propietario', () => {
  it('portalPropietarios: sólo los del usuario', async () => {
    const ps = await portalPropietarios(propA)
    expect(ps.map((p) => p.nombre)).toEqual(['A'])
    expect(ps[0].idioma).toBe('es')
  })

  it('portalResumen: totales esperado/cobrado/pendiente/vencido y unidades de A', async () => {
    const [r, ...otros] = await portalResumen(propA)
    expect(otros).toHaveLength(0)
    expect(r.propietario.id).toBe(ids.propietarioA)
    expect(r.totales).toEqual({ esperado: 24000, cobrado: 13000, pendiente: 5000, vencido: 6000 })
    expect(r.unidades.map((u) => u.unidad_nombre)).toEqual(['101', '102', '103', '104'])
    const porUnidad = Object.fromEntries(r.unidades.map((u) => [u.unidad_nombre, u]))
    expect(porUnidad['101'].cargos.map((c) => c.estatus)).toEqual(['pagado'])
    expect(porUnidad['101'].cargos[0].ultimo_pago_fecha).not.toBeNull()
    expect(porUnidad['102'].cargos.map((c) => c.estatus)).toEqual(['parcial'])
    expect(porUnidad['103'].cargos).toMatchObject([{ estatus: 'vencido', dias_atraso: 3 }])
    expect(porUnidad['103'].inquilino_nombre).toBe('Inquilino Vencido')
    expect(porUnidad['104'].cargos).toEqual([])
  })

  it('sesión de equipo: las vistas del portal no devuelven datos', async () => {
    expect(await portalPropietarios(equipo)).toEqual([])
    expect(await portalResumen(equipo)).toEqual([])
    expect(await portalLiquidaciones(equipo)).toEqual([])
    expect(await portalContratos(equipo)).toEqual([])
    expect(await portalDocumentos(equipo)).toEqual([])
  })

  it('liquidaciones: sólo cerradas/pagadas; detalle con líneas ordenadas', async () => {
    const ls = await portalLiquidaciones(propA)
    expect(ls.map((l) => l.id)).toEqual([cerradaId])
    expect(Number(ls[0].neto)).toBe(7260)
    const d = await portalLiquidacion(propA, cerradaId)
    expect(d?.lineas.map((x) => x.tipo)).toEqual(['cobro', 'gasto_disa'])
    expect(d?.lineas.map((x) => x.comprobante_path)).toEqual([null, `propietarios/${ids.propietarioA}/gastos/g.pdf`])
    expect(d?.cobrado_disa).toBe('10000.00')
    expect(d?.documentos.map((x) => x.nombre)).toEqual(['Factura visible'])
    expect(await portalLiquidacion(propA, borradorId)).toBeNull()
    expect(await portalLiquidacion(propA, 'no-es-uuid')).toBeNull()
  })

  it('contratos y documentos visibles de A', async () => {
    const cs = await portalContratos(propA)
    expect(cs.map((c) => c.unidad_nombre)).toEqual(['101', '102', '103'])
    const docs = await portalDocumentos(propA)
    expect(docs.map((d) => d.nombre)).toEqual(['Factura visible'])
  })
})
