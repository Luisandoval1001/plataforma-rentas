import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { asUser, closeDb, resetDb, seedUsuarios, sqlAdmin } from './harness'

const RLS = /row-level security|permission denied/

const MARZO = '2026-03-01'
const ABRIL = '2026-04-01'
const PAGO_MARZO = '2026-03-03'

type Inmueble = { inmueble: string; unidad: string; contrato: string }

describe('dinero: gastos y liquidaciones (0003_dinero)', () => {
  let u: Awaited<ReturnType<typeof seedUsuarios>>

  /** Inmueble + unidad + inquilino + contrato vigente 2026 con renta 10,000 (día 5). */
  async function inmueble(propietario: string): Promise<Inmueble> {
    const [inm] = await sqlAdmin`insert into inmuebles (propietario_id, nombre, direccion, tipo)
      values (${propietario}, 'Torre', 'Av. 1', 'edificio') returning id`
    const [uni] = await sqlAdmin`insert into unidades (inmueble_id, nombre)
      values (${inm.id}, 'Depto 101') returning id`
    const [inq] = await sqlAdmin`insert into inquilinos (nombre) values ('Juan Pérez') returning id`
    const [c] = await sqlAdmin`insert into contratos
      (unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago)
      values (${uni.id}, ${inq.id}, '2026-01-01', '2026-12-31', 10000, 5)
      returning id`
    return { inmueble: inm.id, unidad: uni.id, contrato: c.id }
  }

  /** Cargo (fixture) del contrato para el periodo dado. */
  async function cargo(
    contratoId: string,
    periodo: string,
    tipo: 'renta' | 'recargo' | 'otro' = 'renta',
    monto = 10000,
  ): Promise<string> {
    const [c] = await sqlAdmin`insert into cargos (contrato_id, tipo, periodo, monto, fecha_limite)
      values (${contratoId}, ${tipo}, ${periodo}, ${monto}, ${periodo}::date + 4)
      returning id`
    return c.id
  }

  function pagar(
    cargos: string[],
    monto: number,
    fecha: string,
    referencia: string,
    cuenta: 'disa' | 'propietario' = 'disa',
  ): Promise<string> {
    return asUser(u.equipo, async (s) => {
      const [r] = await s`select registrar_pago(
        ${cargos}::uuid[], ${monto}, ${fecha}, 'transferencia', ${referencia}, ${cuenta}, null
      ) as id`
      return r.id as string
    })
  }

  function gasto(
    inmuebleId: string,
    fecha: string,
    monto: number,
    pagadoPor: 'disa' | 'propietario',
    unidadId: string | null = null,
  ): Promise<string> {
    return asUser(u.equipo, async (s) => {
      const [g] = await s`insert into gastos (inmueble_id, unidad_id, fecha, concepto, monto, pagado_por)
        values (${inmuebleId}, ${unidadId}, ${fecha}, 'Plomería', ${monto}, ${pagadoPor})
        returning id`
      return g.id as string
    })
  }

  function preparar(propietario: string, periodo: string, usuario?: string): Promise<string> {
    return asUser(usuario ?? u.equipo, async (s) => {
      const [r] = await s`select preparar_liquidacion(${propietario}, ${periodo}) as id`
      return r.id as string
    })
  }

  function cerrar(id: string, usuario?: string) {
    return asUser(usuario ?? u.admin, (s) => s`select cerrar_liquidacion(${id})`)
  }

  async function liq(id: string) {
    const [r] = await asUser(u.equipo, (s) => s`
      select estatus, modelo, comision_pct::float8 as comision_pct, periodo::text as periodo,
             cobrado::float8 as cobrado, cobrado_disa::float8 as cobrado_disa,
             comision::float8 as comision, iva::float8 as iva,
             gastos_disa::float8 as gastos_disa, gastos_propietario::float8 as gastos_propietario,
             ajustes::float8 as ajustes, neto::float8 as neto,
             cerrada_at, cerrada_por, pagada_at, pago_fecha::text as pago_fecha,
             pago_referencia, pago_comprobante_path
      from liquidaciones where id = ${id}`)
    return r
  }

  function lineas(id: string) {
    return asUser(u.equipo, (s) => s`
      select id, tipo, referencia_id, descripcion, monto::float8 as monto
      from liquidacion_lineas where liquidacion_id = ${id}
      order by tipo, monto`)
  }

  /** A: contrato con renta de marzo pagada el 3 de marzo; gasto DISA 1,000 y gasto propietario 500 en marzo. */
  async function escenarioA() {
    const a = await inmueble(u.propietarioA)
    const cargoMarzo = await cargo(a.contrato, MARZO)
    const pago = await pagar([cargoMarzo], 10000, PAGO_MARZO, 'REF-A-MAR')
    const gDisa = await gasto(a.inmueble, '2026-03-10', 1000, 'disa')
    const gProp = await gasto(a.inmueble, '2026-03-20', 500, 'propietario')
    return { ...a, cargoMarzo, pago, gDisa, gProp }
  }

  beforeAll(async () => {
    await resetDb()
  })
  beforeEach(async () => {
    await sqlAdmin`truncate liquidacion_lineas, ajustes_pendientes, liquidaciones, gastos,
      pago_aplicaciones, pagos, cargos, contratos, unidades, inquilinos, inmuebles cascade`
    u = await seedUsuarios()
    await sqlAdmin`update propietarios set modelo = 'cobra_propietario', comision_pct = 12,
      recargos_al_propietario = false where id = ${u.propietarioB}`
    await sqlAdmin`update propietarios set modelo = 'cobra_disa', comision_pct = 15,
      recargos_al_propietario = false where id = ${u.propietarioA}`
  })
  afterAll(async () => {
    await closeDb()
  })

  test('A cobra_disa: cobrado 10000, comision 1500, iva 240, gastos 1000/500, neto 7260; 3 líneas', async () => {
    const a = await escenarioA()
    const id = await preparar(u.propietarioA, MARZO)

    expect(await liq(id)).toMatchObject({
      estatus: 'borrador',
      modelo: 'cobra_disa',
      comision_pct: 15,
      periodo: MARZO,
      cobrado: 10000,
      cobrado_disa: 10000,
      comision: 1500,
      iva: 240,
      gastos_disa: 1000,
      gastos_propietario: 500,
      ajustes: 0,
      neto: 7260,
    })

    const ls = await lineas(id)
    expect(ls).toHaveLength(3)
    const [aplic] = await sqlAdmin`select id from pago_aplicaciones where pago_id = ${a.pago}`
    const porTipo = Object.fromEntries(ls.map((l) => [l.tipo, l]))
    expect(porTipo.cobro).toMatchObject({ referencia_id: aplic.id, monto: 10000 })
    expect(porTipo.cobro.descripcion).toBe('Renta Depto 101 2026-03 — pago 2026-03-03 (cuenta DISA)')
    expect(porTipo.gasto_disa).toMatchObject({ referencia_id: a.gDisa, monto: 1000 })
    expect(porTipo.gasto_propietario).toMatchObject({ referencia_id: a.gProp, monto: 500 })
    expect(ls.map((l) => l.tipo).sort()).toEqual(['cobro', 'gasto_disa', 'gasto_propietario'])
  })

  test('B cobra_propietario: cobrado 10000, comision 1200, iva 192, neto -1392', async () => {
    const b = await inmueble(u.propietarioB)
    const c = await cargo(b.contrato, MARZO)
    await pagar([c], 10000, PAGO_MARZO, 'REF-B-MAR', 'propietario')

    const id = await preparar(u.propietarioB, MARZO)
    expect(await liq(id)).toMatchObject({
      modelo: 'cobra_propietario',
      comision_pct: 12,
      cobrado: 10000,
      cobrado_disa: 0,
      comision: 1200,
      iva: 192,
      gastos_disa: 0,
      gastos_propietario: 0,
      ajustes: 0,
      neto: -1392,
    })
    const ls = await lineas(id)
    expect(ls).toHaveLength(1)
    expect(ls[0].descripcion).toBe('Renta Depto 101 2026-03 — pago 2026-03-03 (cuenta propietario)')
  })

  test('excluye pagos/gastos posteriores al periodo, cancelados y de otro propietario; periodo se normaliza', async () => {
    const a = await escenarioA()
    const b = await inmueble(u.propietarioB)
    await pagar([await cargo(b.contrato, MARZO)], 10000, PAGO_MARZO, 'REF-B')
    const abr = await cargo(a.contrato, ABRIL)
    await pagar([abr], 3000, '2026-04-02', 'REF-A-ABR') // abril: no cuenta en marzo
    const cancelado = await pagar([abr], 2000, '2026-03-31', 'REF-CANC')
    await asUser(u.equipo, (s) => s`select cancelar_pago(${cancelado}, 'error')`)
    await gasto(a.inmueble, '2026-04-01', 999, 'disa') // gasto de abril: no cuenta

    const id = await preparar(u.propietarioA, '2026-03-17')
    expect(await liq(id)).toMatchObject({ periodo: MARZO, cobrado: 10000, gastos_disa: 1000, neto: 7260 })
  })

  test('periodo vacío: neto 0 y se puede cerrar', async () => {
    await escenarioA()
    await cerrar(await preparar(u.propietarioA, MARZO)) // marzo ya liquidado: nada pasa a abril
    const id = await preparar(u.propietarioA, ABRIL)
    expect(await liq(id)).toMatchObject({
      cobrado: 0, comision: 0, iva: 0, gastos_disa: 0, gastos_propietario: 0, ajustes: 0, neto: 0,
    })
    expect(await lineas(id)).toHaveLength(0)
    await cerrar(id)
    expect((await liq(id)).estatus).toBe('cerrada')
  })

  test('preparar dos veces: mismo id, mismas líneas sin duplicar; re-snapshot de modelo/comisión', async () => {
    await escenarioA()
    const id1 = await preparar(u.propietarioA, MARZO)
    const l1 = await lineas(id1)
    const id2 = await preparar(u.propietarioA, MARZO)
    expect(id2).toBe(id1)
    const l2 = await lineas(id2)
    expect(l2).toHaveLength(3)
    expect(l2.map(({ id: _id, ...r }) => r)).toEqual(l1.map(({ id: _id, ...r }) => r))
    const [n] = await sqlAdmin`select count(*)::int as n from liquidaciones`
    expect(n.n).toBe(1)

    await sqlAdmin`update propietarios set comision_pct = 10 where id = ${u.propietarioA}`
    await preparar(u.propietarioA, MARZO)
    expect(await liq(id1)).toMatchObject({ comision_pct: 10, comision: 1000, iva: 160, neto: 7840 })
  })

  test('cerrar: equipo SOLO_ADMIN; admin cierra; segundo cierre ESTATUS_INVALIDO; preparar LIQUIDACION_CERRADA', async () => {
    await escenarioA()
    const id = await preparar(u.propietarioA, MARZO)

    await expect(cerrar(id, u.equipo)).rejects.toThrow(/SOLO_ADMIN/)
    expect((await liq(id)).estatus).toBe('borrador')

    await cerrar(id)
    const l = await liq(id)
    expect(l.estatus).toBe('cerrada')
    expect(l.cerrada_por).toBe(u.admin)
    expect(l.cerrada_at).not.toBeNull()

    await expect(cerrar(id)).rejects.toThrow(/ESTATUS_INVALIDO/)
    await expect(preparar(u.propietarioA, MARZO)).rejects.toThrow(/LIQUIDACION_CERRADA/)
    await expect(preparar(u.propietarioA, '2026-03-15')).rejects.toThrow(/LIQUIDACION_CERRADA/)
  })

  test('propietario no prepara liquidaciones (SOLO_EQUIPO)', async () => {
    await expect(preparar(u.propietarioA, MARZO, u.propA)).rejects.toThrow(/SOLO_EQUIPO/)
  })

  test('inmutabilidad: cancelar pago de marzo cerrado (A cobra_disa) genera ajuste -8260 que se aplica en abril', async () => {
    const a = await escenarioA()
    const marzo = await preparar(u.propietarioA, MARZO)
    await cerrar(marzo)

    await asUser(u.equipo, (s) => s`select cancelar_pago(${a.pago}, 'cheque rebotado')`)

    expect((await liq(marzo)).neto).toBe(7260)
    expect(await lineas(marzo)).toHaveLength(3)

    const ajustes = await sqlAdmin`select propietario_id, monto::float8 as monto, descripcion,
      origen_pago_id, aplicado_en from ajustes_pendientes`
    expect(ajustes).toHaveLength(1)
    expect(ajustes[0]).toMatchObject({
      propietario_id: u.propietarioA,
      monto: -8260,
      descripcion:
        'Cancelación de pago REF-A-MAR del periodo 2026-03: renta 10000.00, comisión 1500.00, IVA 240.00',
      origen_pago_id: a.pago,
      aplicado_en: null,
    })

    const abril = await preparar(u.propietarioA, ABRIL)
    const la = await lineas(abril)
    expect(la).toHaveLength(1)
    expect(la[0]).toMatchObject({ tipo: 'ajuste', monto: -8260 })
    expect(await liq(abril)).toMatchObject({ cobrado: 0, ajustes: -8260, neto: -8260 })

    await cerrar(abril)
    const [aj] = await sqlAdmin`select aplicado_en from ajustes_pendientes`
    expect(aj.aplicado_en).toBe(abril)

    // Ya aplicado: no vuelve a aparecer en mayo.
    const mayo = await preparar(u.propietarioA, '2026-05-01')
    expect(await liq(mayo)).toMatchObject({ ajustes: 0, neto: 0 })
  })

  test('cancelar un pago cuyo cobro sólo está en un borrador no genera ajuste; el borrador se recalcula', async () => {
    const a = await escenarioA()
    const marzo = await preparar(u.propietarioA, MARZO)
    await asUser(u.equipo, (s) => s`select cancelar_pago(${a.pago}, 'error de captura')`)

    const [n] = await sqlAdmin`select count(*)::int as n from ajustes_pendientes`
    expect(n.n).toBe(0)
    await preparar(u.propietarioA, MARZO)
    expect(await liq(marzo)).toMatchObject({ cobrado: 0, neto: -1000 })
  })

  test('B cobra_propietario: cancelar pago de marzo cerrado genera ajuste +1392 (sin referencia: id corto)', async () => {
    const b = await inmueble(u.propietarioB)
    const pago = await pagar([await cargo(b.contrato, MARZO)], 10000, PAGO_MARZO, '', 'propietario')
    await cerrar(await preparar(u.propietarioB, MARZO))

    await asUser(u.equipo, (s) => s`select cancelar_pago(${pago}, 'cheque rebotado')`)
    const [aj] = await sqlAdmin`select monto::float8 as monto, descripcion from ajustes_pendientes`
    expect(aj).toMatchObject({
      monto: 1392,
      descripcion:
        `Cancelación de pago ${pago.slice(0, 8)} del periodo 2026-03: renta 10000.00, comisión 1200.00, IVA 192.00`,
    })
    const abril = await preparar(u.propietarioB, ABRIL)
    expect(await liq(abril)).toMatchObject({ cobrado: 0, ajustes: 1392, neto: 1392 })
  })

  test('cerrar reconstruye: lo registrado o cancelado después de preparar entra al cierre', async () => {
    const a = await escenarioA()
    const marzo = await preparar(u.propietarioA, MARZO)
    expect((await liq(marzo)).cobrado).toBe(10000)

    const abr = await cargo(a.contrato, ABRIL)
    await pagar([abr], 4000, '2026-03-28', 'REF-ADELANTO') // adelanto de abril pagado en marzo
    await gasto(a.inmueble, '2026-03-29', 300, 'disa')

    await cerrar(marzo)
    expect(await liq(marzo)).toMatchObject({
      estatus: 'cerrada', cobrado: 14000, comision: 2100, iva: 336, gastos_disa: 1300,
      neto: 14000 - 2100 - 336 - 1300,
    })
    expect(await lineas(marzo)).toHaveLength(5)
  })

  test('cerrar reconstruye: cobro de un pago cancelado tras preparar no entra al cierre', async () => {
    const a = await escenarioA()
    const marzo = await preparar(u.propietarioA, MARZO)
    await asUser(u.equipo, (s) => s`select cancelar_pago(${a.pago}, 'error de captura')`)
    await cerrar(marzo)
    expect(await liq(marzo)).toMatchObject({ estatus: 'cerrada', cobrado: 0, neto: -1000 })
  })

  test('cancelar_pago simultáneo a cerrar_liquidacion espera al cierre y genera el ajuste', async () => {
    const a = await escenarioA()
    const marzo = await preparar(u.propietarioA, MARZO)

    let soltar!: () => void
    const espera = new Promise<void>((r) => (soltar = r))
    let cerrado!: () => void
    const yaCerro = new Promise<void>((r) => (cerrado = r))
    const cierre = asUser(u.admin, async (s) => {
      await s`select cerrar_liquidacion(${marzo})`
      cerrado()
      await espera // mantiene la transacción del cierre abierta
    })
    await yaCerro
    const cancelacion = asUser(u.equipo, (s) => s`select cancelar_pago(${a.pago}, 'cheque rebotado')`)
    await new Promise((r) => setTimeout(r, 300))
    soltar()
    await cierre
    await cancelacion

    expect(await liq(marzo)).toMatchObject({ estatus: 'cerrada', cobrado: 10000, neto: 7260 })
    const [aj] = await sqlAdmin`select monto::float8 as monto from ajustes_pendientes`
    expect(aj?.monto).toBe(-8260)
  })

  test('pago y gasto con fecha de un mes ya cerrado entran al siguiente periodo abierto', async () => {
    const a = await escenarioA()
    await cerrar(await preparar(u.propietarioA, MARZO))

    const otroInm = await inmueble(u.propietarioA)
    const tardio = await pagar([await cargo(otroInm.contrato, MARZO)], 10000, '2026-03-20', 'REF-TARDE')
    await gasto(a.inmueble, '2026-03-25', 200, 'disa')

    const abril = await preparar(u.propietarioA, ABRIL)
    const [aplic] = await sqlAdmin`select id from pago_aplicaciones where pago_id = ${tardio}`
    const la = await lineas(abril)
    expect(la.filter((l) => l.tipo === 'cobro')).toEqual([
      expect.objectContaining({
        referencia_id: aplic.id, monto: 10000,
        descripcion: 'Renta Depto 101 2026-03 — pago 2026-03-20 (cuenta DISA)',
      }),
    ])
    expect(await liq(abril)).toMatchObject({
      cobrado: 10000, comision: 1500, iva: 240, gastos_disa: 200, neto: 10000 - 1500 - 240 - 200,
    })
    // Marzo (cerrado) no cambia.
    expect((await liq((await sqlAdmin`select id from liquidaciones where periodo = ${MARZO}`)[0].id)).neto).toBe(7260)
  })

  test('registrar_ajuste: sólo admin; el ajuste aparece en el siguiente preparar', async () => {
    const ajuste = (usuario: string, monto: number, desc: string) =>
      asUser(usuario, async (s) => {
        const [r] = await s`select registrar_ajuste(${u.propietarioA}, ${monto}, ${desc}) as id`
        return r.id as string
      })

    await expect(ajuste(u.equipo, 500, 'Corrección')).rejects.toThrow(/SOLO_ADMIN/)
    await expect(ajuste(u.admin, 0, 'Corrección')).rejects.toThrow(/MONTO_INVALIDO/)
    await expect(ajuste(u.admin, 500, '  ')).rejects.toThrow(/DESCRIPCION_REQUERIDA/)

    const id = await ajuste(u.admin, -750.5, 'Corrección de gasto de febrero')
    const [r] = await sqlAdmin`select origen_pago_id, aplicado_en from ajustes_pendientes where id = ${id}`
    expect(r).toMatchObject({ origen_pago_id: null, aplicado_en: null })

    const marzo = await preparar(u.propietarioA, MARZO)
    expect(await lineas(marzo)).toEqual([
      expect.objectContaining({
        tipo: 'ajuste', referencia_id: id, descripcion: 'Corrección de gasto de febrero', monto: -750.5,
      }),
    ])
    expect(await liq(marzo)).toMatchObject({ ajustes: -750.5, neto: -750.5 })
  })

  test('UPDATE directo de una liquidación cerrada o de sus líneas: LIQUIDACION_INMUTABLE', async () => {
    await escenarioA()
    const id = await preparar(u.propietarioA, MARZO)
    await cerrar(id)

    await expect(sqlAdmin`update liquidaciones set neto = 0 where id = ${id}`).rejects.toThrow(
      /LIQUIDACION_INMUTABLE/,
    )
    await expect(sqlAdmin`update liquidaciones set estatus = 'borrador' where id = ${id}`).rejects.toThrow(
      /LIQUIDACION_INMUTABLE/,
    )
    await expect(
      sqlAdmin`update liquidacion_lineas set monto = 1 where liquidacion_id = ${id}`,
    ).rejects.toThrow(/LIQUIDACION_INMUTABLE/)
    await expect(
      sqlAdmin`delete from liquidacion_lineas where liquidacion_id = ${id}`,
    ).rejects.toThrow(/LIQUIDACION_INMUTABLE/)
    await expect(
      sqlAdmin`insert into liquidacion_lineas (liquidacion_id, tipo, descripcion, monto)
        values (${id}, 'ajuste', 'x', 1)`,
    ).rejects.toThrow(/LIQUIDACION_INMUTABLE/)
    expect((await liq(id)).neto).toBe(7260)
  })

  test('pagar_liquidacion: desde borrador ESTATUS_INVALIDO; desde cerrada queda pagada e inmutable', async () => {
    await escenarioA()
    const id = await preparar(u.propietarioA, MARZO)

    const pagarLiq = (usuario: string) =>
      asUser(usuario, (s) => s`select pagar_liquidacion(${id}, '2026-04-05', 'SPEI-123', 'comprobantes/x.pdf')`)

    await expect(pagarLiq(u.equipo)).rejects.toThrow(/ESTATUS_INVALIDO/)
    await cerrar(id)
    await expect(pagarLiq(u.propA)).rejects.toThrow(/SOLO_EQUIPO/)
    await pagarLiq(u.equipo)

    const l = await liq(id)
    expect(l).toMatchObject({
      estatus: 'pagada',
      pago_fecha: '2026-04-05',
      pago_referencia: 'SPEI-123',
      pago_comprobante_path: 'comprobantes/x.pdf',
      neto: 7260,
    })
    expect(l.pagada_at).not.toBeNull()

    await expect(pagarLiq(u.equipo)).rejects.toThrow(/ESTATUS_INVALIDO/)
    await expect(sqlAdmin`update liquidaciones set pago_referencia = 'otra' where id = ${id}`).rejects.toThrow(
      /LIQUIDACION_INMUTABLE/,
    )
  })

  test('registrar_pdf_liquidacion: borrador ESTATUS_INVALIDO; cerrada guarda pdf_path; neto sigue inmutable', async () => {
    await escenarioA()
    const id = await preparar(u.propietarioA, MARZO)
    const pdf = (usuario: string) =>
      asUser(usuario, (s) => s`select registrar_pdf_liquidacion(${id}, 'propietarios/a/liquidaciones/2026-03.pdf')`)

    await expect(pdf(u.equipo)).rejects.toThrow(/ESTATUS_INVALIDO/)
    await cerrar(id)
    await expect(pdf(u.propA)).rejects.toThrow(/SOLO_EQUIPO/)
    await pdf(u.equipo)
    const [r] = await sqlAdmin`select pdf_path, estatus, neto::float8 as neto from liquidaciones where id = ${id}`
    expect(r).toMatchObject({
      pdf_path: 'propietarios/a/liquidaciones/2026-03.pdf', estatus: 'cerrada', neto: 7260,
    })

    await expect(sqlAdmin`update liquidaciones set neto = 0 where id = ${id}`).rejects.toThrow(
      /LIQUIDACION_INMUTABLE/,
    )
    await expect(
      sqlAdmin`update liquidaciones set pdf_path = 'x.pdf', neto = 0 where id = ${id}`,
    ).rejects.toThrow(/LIQUIDACION_INMUTABLE/)
  })

  test('ajuste en dos borradores: se cierran en orden; el primero lo aplica y el siguiente lo excluye', async () => {
    const a = await escenarioA()
    await cerrar(await preparar(u.propietarioA, MARZO))
    await asUser(u.equipo, (s) => s`select cancelar_pago(${a.pago}, 'cheque rebotado')`)

    const abril = await preparar(u.propietarioA, ABRIL)
    const mayo = await preparar(u.propietarioA, '2026-05-01')
    expect((await liq(abril)).ajustes).toBe(-8260)
    expect((await liq(mayo)).ajustes).toBe(-8260)
    await expect(cerrar(mayo)).rejects.toThrow(/PERIODO_ANTERIOR_ABIERTO/)

    await cerrar(abril)
    expect(await liq(abril)).toMatchObject({ estatus: 'cerrada', ajustes: -8260, neto: -8260 })
    await cerrar(mayo)
    expect(await liq(mayo)).toMatchObject({ estatus: 'cerrada', ajustes: 0, neto: 0 })
    const [aj] = await sqlAdmin`select aplicado_en from ajustes_pendientes`
    expect(aj.aplicado_en).toBe(abril)
  })

  test('cerrar el mes en curso o uno futuro: PERIODO_EN_CURSO', async () => {
    await inmueble(u.propietarioA)
    const [{ actual, siguiente, anterior }] = await sqlAdmin`select
      date_trunc('month', current_date)::date::text as actual,
      (date_trunc('month', current_date) + interval '1 month')::date::text as siguiente,
      (date_trunc('month', current_date) - interval '1 month')::date::text as anterior`
    const enCurso = await preparar(u.propietarioA, actual)
    await expect(cerrar(enCurso)).rejects.toThrow(/PERIODO_EN_CURSO/)
    const futuro = await preparar(u.propietarioA, siguiente)
    await expect(cerrar(futuro)).rejects.toThrow(/PERIODO_EN_CURSO/)
    expect((await liq(enCurso)).estatus).toBe('borrador')
    await cerrar(await preparar(u.propietarioA, anterior))
  })

  test('cerrar con un borrador anterior abierto del mismo propietario: PERIODO_ANTERIOR_ABIERTO', async () => {
    await escenarioA()
    const marzo = await preparar(u.propietarioA, MARZO)
    const abril = await preparar(u.propietarioA, ABRIL)
    const otro = await preparar(u.propietarioB, '2026-02-01') // otro propietario: no estorba
    await expect(cerrar(abril)).rejects.toThrow(/PERIODO_ANTERIOR_ABIERTO/)
    await cerrar(marzo)
    await cerrar(abril)
    expect((await liq(abril)).estatus).toBe('cerrada')
    expect((await liq(otro)).estatus).toBe('borrador')
  })

  test('cuentas mezcladas (cobra_disa): neto = cobrado en cuenta DISA − comisión − IVA; cancelaciones por cuenta', async () => {
    const a1 = await inmueble(u.propietarioA)
    const a2 = await inmueble(u.propietarioA)
    const pDisa = await pagar([await cargo(a1.contrato, MARZO)], 10000, PAGO_MARZO, 'REF-D', 'disa')
    const pProp = await pagar([await cargo(a2.contrato, MARZO)], 10000, PAGO_MARZO, 'REF-P', 'propietario')

    const marzo = await preparar(u.propietarioA, MARZO)
    expect(await liq(marzo)).toMatchObject({
      cobrado: 20000, cobrado_disa: 10000, comision: 3000, iva: 480, neto: 6520,
    })
    expect((await lineas(marzo)).map((l) => l.descripcion).sort()).toEqual([
      'Renta Depto 101 2026-03 — pago 2026-03-03 (cuenta DISA)',
      'Renta Depto 101 2026-03 — pago 2026-03-03 (cuenta propietario)',
    ])
    await cerrar(marzo)

    await asUser(u.equipo, (s) => s`select cancelar_pago(${pProp}, 'error de cuenta')`)
    await asUser(u.equipo, (s) => s`select cancelar_pago(${pDisa}, 'cheque rebotado')`)
    const ajustes = await sqlAdmin`select origen_pago_id, monto::float8 as monto from ajustes_pendientes`
    expect(Object.fromEntries(ajustes.map((x) => [x.origen_pago_id, x.monto]))).toEqual({
      [pProp]: 1740,
      [pDisa]: -8260,
    })
  })

  test('recargos_al_propietario: true → cobrado 10500; false → 10000', async () => {
    const a = await inmueble(u.propietarioA)
    const renta = await cargo(a.contrato, MARZO)
    const recargo = await cargo(a.contrato, MARZO, 'recargo', 500)
    const otro = await cargo(a.contrato, MARZO, 'otro', 300)
    await pagar([renta, recargo, otro], 10800, PAGO_MARZO, 'REF-REC')

    const id = await preparar(u.propietarioA, MARZO)
    expect((await liq(id)).cobrado).toBe(10000)

    await sqlAdmin`update propietarios set recargos_al_propietario = true where id = ${u.propietarioA}`
    await preparar(u.propietarioA, MARZO)
    expect((await liq(id)).cobrado).toBe(10500)
    const cobros = (await lineas(id)).filter((l) => l.tipo === 'cobro')
    expect(cobros).toHaveLength(2)
  })

  describe('gastos y RLS', () => {
    test('propietario_id se deriva del inmueble; registrado_por = usuario; monto > 0', async () => {
      const a = await inmueble(u.propietarioA)
      const id = await asUser(u.equipo, async (s) => {
        const [g] = await s`insert into gastos (propietario_id, inmueble_id, unidad_id, fecha, concepto, monto, pagado_por)
          values (${u.propietarioB}, ${a.inmueble}, ${a.unidad}, '2026-03-10', 'Pintura', 1000, 'disa')
          returning id`
        return g.id as string
      })
      const [g] = await sqlAdmin`select propietario_id, registrado_por from gastos where id = ${id}`
      expect(g).toMatchObject({ propietario_id: u.propietarioA, registrado_por: u.equipo })

      await expect(gasto(a.inmueble, '2026-03-10', 0, 'disa')).rejects.toThrow(/check constraint/)
    })

    test('unidad de otro inmueble: UNIDAD_DE_OTRO_INMUEBLE', async () => {
      const a1 = await inmueble(u.propietarioA)
      const a2 = await inmueble(u.propietarioA)
      await expect(gasto(a1.inmueble, '2026-03-10', 100, 'disa', a2.unidad)).rejects.toThrow(
        /UNIDAD_DE_OTRO_INMUEBLE/,
      )
    })

    test('equipo inserta y edita gastos pero no los borra; admin sí', async () => {
      const a = await inmueble(u.propietarioA)
      const id = await gasto(a.inmueble, '2026-03-10', 100, 'disa')
      await asUser(u.equipo, (s) => s`update gastos set monto = 150 where id = ${id}`)

      await expect(
        asUser(u.equipo, (s) => s`delete from gastos where id = ${id}`),
      ).rejects.toThrow(/SOLO_ADMIN/)
      const [n1] = await sqlAdmin`select count(*)::int as n, max(monto)::float8 as m from gastos`
      expect(n1).toMatchObject({ n: 1, m: 150 })

      await asUser(u.admin, (s) => s`delete from gastos where id = ${id}`)
      const [n2] = await sqlAdmin`select count(*)::int as n from gastos`
      expect(n2.n).toBe(0)
    })

    test('gasto incluido en una liquidación cerrada: GASTO_LIQUIDADO al editar o borrar', async () => {
      const a = await escenarioA()
      const marzo = await preparar(u.propietarioA, MARZO)

      // En borrador todavía se puede editar.
      await asUser(u.equipo, (s) => s`update gastos set concepto = 'Plomería baño' where id = ${a.gDisa}`)
      await cerrar(marzo)

      await expect(
        asUser(u.equipo, (s) => s`update gastos set monto = 1 where id = ${a.gDisa}`),
      ).rejects.toThrow(/GASTO_LIQUIDADO/)
      await expect(
        asUser(u.admin, (s) => s`update gastos set monto = 1 where id = ${a.gProp}`),
      ).rejects.toThrow(/GASTO_LIQUIDADO/)
      await expect(
        asUser(u.admin, (s) => s`delete from gastos where id = ${a.gDisa}`),
      ).rejects.toThrow(/GASTO_LIQUIDADO/)

      // Un gasto no liquidado sí se puede borrar (admin).
      const nuevo = await gasto(a.inmueble, '2026-04-02', 100, 'disa')
      await asUser(u.admin, (s) => s`delete from gastos where id = ${nuevo}`)
      const [n] = await sqlAdmin`select count(*)::int as n from gastos`
      expect(n.n).toBe(2)
    })

    test('nadie inserta ni modifica liquidaciones, líneas ni ajustes directamente', async () => {
      await expect(
        asUser(u.equipo, (s) => s`insert into liquidaciones (propietario_id, periodo, modelo, comision_pct)
          values (${u.propietarioA}, ${MARZO}, 'cobra_disa', 15)`),
      ).rejects.toThrow(RLS)
      await expect(
        asUser(u.admin, (s) => s`insert into liquidaciones (propietario_id, periodo, modelo, comision_pct)
          values (${u.propietarioA}, ${MARZO}, 'cobra_disa', 15)`),
      ).rejects.toThrow(RLS)
      await expect(
        asUser(u.admin, (s) => s`insert into ajustes_pendientes (propietario_id, monto, descripcion)
          values (${u.propietarioA}, 100, 'x')`),
      ).rejects.toThrow(RLS)

      await escenarioA()
      const id = await preparar(u.propietarioA, MARZO)
      await expect(
        asUser(u.admin, (s) => s`update liquidaciones set neto = 0 where id = ${id}`),
      ).rejects.toThrow(RLS)
      await expect(
        asUser(u.admin, (s) => s`delete from liquidacion_lineas where liquidacion_id = ${id}`),
      ).rejects.toThrow(RLS)
      await expect(
        asUser(u.admin, (s) => s`delete from liquidaciones where id = ${id}`),
      ).rejects.toThrow(RLS)
    })

    test('admin y equipo leen liquidaciones; propietario no ve tablas de dinero', async () => {
      await escenarioA()
      await preparar(u.propietarioA, MARZO)
      expect(await asUser(u.admin, (s) => s`select id from liquidaciones`)).toHaveLength(1)
      expect(await asUser(u.admin, (s) => s`select id from liquidacion_lineas`)).toHaveLength(3)
      expect(await asUser(u.propA, (s) => s`select * from liquidaciones`)).toEqual([])
      expect(await asUser(u.propA, (s) => s`select * from liquidacion_lineas`)).toEqual([])
      expect(await asUser(u.propA, (s) => s`select * from gastos`)).toEqual([])
      expect(await asUser(u.propA, (s) => s`select * from ajustes_pendientes`)).toEqual([])
    })
  })
})
