import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { asUser, closeDb, resetDb, seedUsuarios, sqlAdmin } from './harness'

// Ajustes de la revisión final (0009_ajustes_revision): renovaciones anticipadas, cargos_desde,
// incremento anual, usuarios inactivos, comprobantes de gastos en el portal y bitácora de ajustes.

type Opciones = {
  fecha_inicio?: string
  fecha_fin?: string
  renta?: number
  incremento?: number
  cargos_desde?: string | null
  propietario?: string
}

describe('ajustes de la revisión (0009_ajustes_revision)', () => {
  let u: Awaited<ReturnType<typeof seedUsuarios>>

  async function unidad(propietario: string = u.propietarioA) {
    const [inm] = await sqlAdmin`insert into inmuebles (propietario_id, nombre, tipo)
      values (${propietario}, 'Torre', 'edificio') returning id`
    const [uni] = await sqlAdmin`insert into unidades (inmueble_id, nombre) values (${inm.id}, 'Depto 101') returning id`
    const [inq] = await sqlAdmin`insert into inquilinos (nombre) values ('Juan Pérez') returning id`
    return { inmueble: inm.id as string, unidad: uni.id as string, inquilino: inq.id as string }
  }

  async function contrato(o: Opciones = {}) {
    const x = await unidad(o.propietario)
    const [c] = await sqlAdmin`insert into contratos
      (unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago, incremento_anual_pct, cargos_desde)
      values (${x.unidad}, ${x.inquilino}, ${o.fecha_inicio ?? '2026-01-01'}, ${o.fecha_fin ?? '2026-12-31'},
              ${o.renta ?? 10000}, 5, ${o.incremento ?? 0}, ${o.cargos_desde ?? null})
      returning id`
    return { ...x, contrato: c.id as string }
  }

  const generar = (periodo: string) =>
    asUser(u.equipo, async (s) => (await s`select generar_cargos_renta(${periodo}::date) as n`)[0].n as number)

  async function cargosDe(periodo: string) {
    return sqlAdmin`select contrato_id, monto::float8 as monto from cargos
      where tipo = 'renta' and periodo = ${periodo}::date order by contrato_id`
  }

  beforeAll(async () => {
    await resetDb()
  })
  beforeEach(async () => {
    await sqlAdmin`truncate liquidacion_lineas, ajustes_pendientes, liquidaciones, gastos,
      pago_aplicaciones, pagos, cargos, contratos, unidades, inquilinos, inmuebles cascade`
    u = await seedUsuarios()
    await sqlAdmin`update usuarios set activo = true`
    await sqlAdmin`update propietarios set modelo = 'cobra_disa', comision_pct = 15`
  })
  afterAll(async () => {
    await closeDb()
  })

  describe('F1: renovación activada antes del fin del contrato de origen', () => {
    test('el origen se sigue cobrando hasta su fecha_fin; luego la renovación; nunca ambos el mismo mes', async () => {
      const [m] = await sqlAdmin`select
        (date_trunc('month', current_date) + interval '1 month')::date::text as siguiente,
        (date_trunc('month', current_date) + interval '2 month')::date::text as despues,
        (date_trunc('month', current_date) + interval '2 month' - interval '1 day')::date::text as fin`
      const o = await contrato({ fecha_inicio: '2025-01-01', fecha_fin: m.fin })
      // renovarContrato + activarContrato (mismas sentencias que las acciones).
      const [r] = await sqlAdmin`insert into contratos (unidad_id, inquilino_id, fecha_inicio, fecha_fin,
          renta_mensual, dia_pago, estatus, pendiente_firma_desde, contrato_origen_id)
        values (${o.unidad}, ${o.inquilino}, ${m.despues}::date, (${m.despues}::date + interval '1 year' - interval '1 day')::date,
          10500, 5, 'pendiente_firma', current_date, ${o.contrato}) returning id`
      await sqlAdmin`update contratos set estatus = 'terminado' where id = ${o.contrato}`
      await sqlAdmin`update contratos set estatus = 'vigente' where id = ${r.id}`

      expect(await generar(m.siguiente)).toBe(1)
      expect(await cargosDe(m.siguiente)).toEqual([{ contrato_id: o.contrato, monto: 10000 }])
      expect(await generar(m.despues)).toBe(1)
      expect(await cargosDe(m.despues)).toEqual([{ contrato_id: r.id, monto: 10500 }])

      const vista = await asUser(u.equipo, (s) => s`select id, estatus_calc, tiene_sucesor_vigente
        from v_contratos order by fecha_inicio`)
      expect(vista[0]).toMatchObject({ id: o.contrato, tiene_sucesor_vigente: true })
      expect(['vigente', 'por_vencer']).toContain(vista[0].estatus_calc)
      expect(vista[1]).toMatchObject({ id: r.id, estatus_calc: 'vigente', tiene_sucesor_vigente: false })
      const [p] = await asUser(u.propA, (s) => s`select estatus_calc from portal_contratos where contrato_id = ${o.contrato}`)
      expect(p.estatus_calc).toBe(vista[0].estatus_calc)

      // Pasada su fecha_fin, el origen ya se reporta como terminado.
      await sqlAdmin`update contratos set fecha_fin = current_date - 1, fecha_inicio = '2025-01-01' where id = ${o.contrato}`
      const [v] = await asUser(u.equipo, (s) => s`select estatus_calc from v_contratos where id = ${o.contrato}`)
      expect(v.estatus_calc).toBe('terminado')
    })

    test('una renovación con origen que vence a media quincena no se cobra junto con el origen', async () => {
      const o = await contrato({ fecha_inicio: '2025-01-15', fecha_fin: '2026-01-14' })
      const [r] = await sqlAdmin`insert into contratos (unidad_id, inquilino_id, fecha_inicio, fecha_fin,
          renta_mensual, dia_pago, estatus, contrato_origen_id)
        values (${o.unidad}, ${o.inquilino}, '2026-01-15', '2027-01-14', 10500, 5, 'pendiente_firma', ${o.contrato})
        returning id`
      await sqlAdmin`update contratos set estatus = 'terminado' where id = ${o.contrato}`
      await sqlAdmin`update contratos set estatus = 'vigente' where id = ${r.id}`
      await generar('2026-01-01')
      await generar('2026-02-01')
      expect(await cargosDe('2026-01-01')).toEqual([{ contrato_id: o.contrato, monto: 10000 }])
      expect(await cargosDe('2026-02-01')).toEqual([{ contrato_id: r.id, monto: 10500 }])
    })

    test('un contrato terminado sin renovación vigente no se cobra', async () => {
      const o = await contrato()
      await sqlAdmin`update contratos set estatus = 'terminado' where id = ${o.contrato}`
      expect(await generar('2026-03-01')).toBe(0)
    })
  })

  describe('F8: cargos_desde', () => {
    test('por omisión = fecha_inicio; no puede ser anterior; se cobra desde su mes', async () => {
      const a = await contrato({ fecha_inicio: '2026-01-10' })
      const [c] = await sqlAdmin`select cargos_desde::text as d from contratos where id = ${a.contrato}`
      expect(c.d).toBe('2026-01-10')
      expect(await generar('2026-01-01')).toBe(1)

      const b = await contrato({ fecha_inicio: '2026-01-01', cargos_desde: '2026-03-15' })
      expect(await generar('2026-02-01')).toBe(1) // sólo el contrato a
      expect((await cargosDe('2026-02-01')).map((x) => x.contrato_id)).toEqual([a.contrato])
      await generar('2026-03-01')
      expect((await cargosDe('2026-03-01')).map((x) => x.contrato_id).sort()).toEqual([a.contrato, b.contrato].sort())

      await expect(
        sqlAdmin`update contratos set cargos_desde = '2025-12-31' where id = ${b.contrato}`,
      ).rejects.toThrow(/check constraint/)
    })
  })

  describe('F12: incremento anual en contratos de varios años', () => {
    test('3 años al 5%: 10000, 10500, 11025; renta_actual en v_contratos y portal', async () => {
      const a = await contrato({ fecha_inicio: '2024-01-01', fecha_fin: '2026-12-31', incremento: 5 })
      for (const p of ['2024-01-01', '2024-12-01', '2025-01-01', '2025-12-01', '2026-01-01', '2026-06-01']) await generar(p)
      const montos = await sqlAdmin`select periodo::text as p, monto::float8 as m from cargos order by periodo`
      expect(montos.map((x) => [x.p, x.m])).toEqual([
        ['2024-01-01', 10000], ['2024-12-01', 10000],
        ['2025-01-01', 10500], ['2025-12-01', 10500],
        ['2026-01-01', 11025], ['2026-06-01', 11025],
      ])
      const [v] = await asUser(u.equipo, (s) => s`select renta_actual::float8 as r from v_contratos where id = ${a.contrato}`)
      expect(v.r).toBe(11025)
      const [p] = await asUser(u.propA, (s) => s`select renta_actual::float8 as r from portal_contratos`)
      expect(p.r).toBe(11025)
    })

    test('inicio a mitad de mes: el año se cumple el primer periodo que empieza después del aniversario', async () => {
      await contrato({ fecha_inicio: '2025-01-15', fecha_fin: '2027-01-14', incremento: 10 })
      await generar('2026-01-01')
      await generar('2026-02-01')
      const montos = await sqlAdmin`select periodo::text as p, monto::float8 as m from cargos order by periodo`
      expect(montos.map((x) => x.m)).toEqual([10000, 11000])
      const [r] = await sqlAdmin`select app.renta_vigente(10000, 5, '2024-01-01', '2023-06-01')::float8 as antes,
        app.renta_vigente(10000, 0, '2024-01-01', '2030-01-01')::float8 as sin_incremento`
      expect(r).toEqual({ antes: 10000, sin_incremento: 10000 })
    })
  })

  describe('F4/F13: usuarios inactivos', () => {
    test('rol_actual() nulo y RLS no devuelve nada; portal vacío', async () => {
      await contrato()
      await sqlAdmin`update usuarios set activo = false where id in (${u.equipo}, ${u.propA})`
      const [r] = await asUser(u.equipo, (s) => s`select app.rol_actual() as rol`)
      expect(r.rol).toBeNull()
      expect(await asUser(u.equipo, (s) => s`select id from contratos`)).toEqual([])
      expect(await asUser(u.equipo, (s) => s`select id from propietarios`)).toEqual([])
      await expect(generar('2026-03-01')).rejects.toThrow(/SOLO_EQUIPO/)
      expect(await asUser(u.propA, (s) => s`select app.mis_propietarios()`)).toEqual([])
      expect(await asUser(u.propA, (s) => s`select * from portal_propietario`)).toEqual([])
      expect(await asUser(u.propA, (s) => s`select * from portal_contratos`)).toEqual([])

      await sqlAdmin`update usuarios set activo = true where id = ${u.equipo}`
      expect(await asUser(u.equipo, (s) => s`select id from contratos`)).toHaveLength(1)
    })
  })

  describe('F10: comprobantes de gastos en el portal', () => {
    test('portal_liquidacion_lineas expone comprobante_path de las líneas de gasto propias', async () => {
      const a = await contrato()
      const b = await contrato({ propietario: u.propietarioB })
      for (const [x, prop] of [[a, u.propietarioA], [b, u.propietarioB]] as const) {
        await asUser(u.equipo, (s) => s`insert into gastos (inmueble_id, fecha, concepto, monto, pagado_por, comprobante_path)
          values (${x.inmueble}, '2026-03-10', 'Plomería', 1000, 'disa', ${`propietarios/${prop}/gastos/g.pdf`})`)
        await asUser(u.equipo, (s) => s`insert into gastos (inmueble_id, fecha, concepto, monto, pagado_por)
          values (${x.inmueble}, '2026-03-11', 'Pintura', 200, 'propietario')`)
        const [l] = await asUser(u.equipo, (s) => s`select preparar_liquidacion(${prop}, '2026-03-01') as id`)
        await asUser(u.admin, (s) => s`select cerrar_liquidacion(${l.id})`)
      }
      const ls = await asUser(u.propA, (s) => s`select tipo, comprobante_path from portal_liquidacion_lineas order by tipo`)
      expect(ls).toEqual([
        { tipo: 'gasto_disa', comprobante_path: `propietarios/${u.propietarioA}/gastos/g.pdf` },
        { tipo: 'gasto_propietario', comprobante_path: null },
      ])
      const lb = await asUser(u.propB, (s) => s`select comprobante_path from portal_liquidacion_lineas`)
      expect(lb.map((x) => x.comprobante_path)).not.toContain(`propietarios/${u.propietarioA}/gastos/g.pdf`)
    })
  })

  describe('F11: ajustes manuales auditados', () => {
    test('registrar_ajuste guarda creado_por y deja renglón en bitácora', async () => {
      const [r] = await asUser(u.admin, (s) => s`select registrar_ajuste(${u.propietarioA}, 150, 'Corrección') as id`)
      const [a] = await sqlAdmin`select creado_por from ajustes_pendientes where id = ${r.id}`
      expect(a.creado_por).toBe(u.admin)
      const b = await sqlAdmin`select tabla, accion, usuario_id from bitacora where registro_id = ${r.id}`
      expect(b).toEqual([{ tabla: 'ajustes_pendientes', accion: 'INSERT', usuario_id: u.admin }])
    })
  })
})
