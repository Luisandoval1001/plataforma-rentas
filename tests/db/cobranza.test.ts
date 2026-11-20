import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { asUser, closeDb, resetDb, seedUsuarios, sqlAdmin } from './harness'

const RLS = /row-level security|permission denied/
const UNIQUE = /duplicate key value violates unique constraint/

type Opciones = {
  fecha_inicio?: string
  fecha_fin?: string
  dia_pago?: number
  renta?: number
  estatus?: 'pendiente_firma' | 'vigente' | 'terminado'
  pendiente_firma_desde?: string | null
  propietario?: string
}

describe('cobranza: cargos, pagos y estatus calculados (0002_cobranza)', () => {
  let u: Awaited<ReturnType<typeof seedUsuarios>>

  /** Inmueble + unidad + inquilino + contrato (por defecto: A, vigente 2026-01-01→2026-12-31, renta 10,000, día 5). */
  async function contrato(o: Opciones = {}): Promise<string> {
    const [inm] = await sqlAdmin`insert into inmuebles (propietario_id, nombre, direccion, tipo)
      values (${o.propietario ?? u.propietarioA}, 'Torre', 'Av. 1', 'edificio') returning id`
    const [uni] = await sqlAdmin`insert into unidades (inmueble_id, nombre)
      values (${inm.id}, 'Depto 101') returning id`
    const [inq] = await sqlAdmin`insert into inquilinos (nombre) values ('Juan Pérez') returning id`
    const [c] = await sqlAdmin`insert into contratos
      (unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago, estatus, pendiente_firma_desde)
      values (${uni.id}, ${inq.id}, ${o.fecha_inicio ?? '2026-01-01'}, ${o.fecha_fin ?? '2026-12-31'},
              ${o.renta ?? 10000}, ${o.dia_pago ?? 5}, ${o.estatus ?? 'vigente'},
              ${o.pendiente_firma_desde ?? null})
      returning id`
    return c.id
  }

  /** Cargo de renta del contrato para el periodo dado (lo crea generar_cargos_renta). */
  async function cargoDe(contratoId: string, periodo: string): Promise<string> {
    const [c] = await sqlAdmin`select id from cargos
      where contrato_id = ${contratoId} and periodo = ${periodo} and tipo = 'renta'`
    return c.id
  }

  /** Cargo insertado directamente (fixture) con fecha_limite relativa a current_date de la BD. */
  async function cargoConLimite(contratoId: string, monto: number, diasDesdeHoy: number): Promise<string> {
    const [c] = await sqlAdmin`insert into cargos (contrato_id, tipo, periodo, monto, fecha_limite)
      values (${contratoId}, 'renta', date_trunc('month', current_date)::date, ${monto},
              current_date + ${diasDesdeHoy}::int)
      returning id`
    return c.id
  }

  async function vCargo(id: string) {
    const [r] = await asUser(u.equipo, (s) => s`
      select monto::float8 as monto, pagado::float8 as pagado, saldo::float8 as saldo,
             estatus, dias_atraso
      from v_cargos where id = ${id}`)
    return r
  }

  function pagar(
    cargos: string[],
    monto: number,
    referencia = '',
    usuario?: string,
  ): Promise<string> {
    return asUser(usuario ?? u.equipo, async (s) => {
      const [r] = await s`select registrar_pago(
        ${cargos}::uuid[], ${monto}, current_date, 'transferencia', ${referencia}, 'disa', null
      ) as id`
      return r.id as string
    })
  }

  beforeAll(async () => {
    await resetDb()
  })
  beforeEach(async () => {
    await sqlAdmin`truncate pago_aplicaciones, pagos, cargos, contratos, unidades, inquilinos, inmuebles cascade`
    u = await seedUsuarios()
  })
  afterAll(async () => {
    await closeDb()
  })

  test('generar_cargos_renta inserta una vez por periodo con monto y fecha_limite', async () => {
    const c = await contrato()
    const n1 = await asUser(u.equipo, (s) => s`select generar_cargos_renta('2026-03-01') as n`)
    expect(n1[0].n).toBe(1)
    const n2 = await asUser(u.equipo, (s) => s`select generar_cargos_renta('2026-03-01') as n`)
    expect(n2[0].n).toBe(0)

    const filas = await asUser(u.equipo, (s) => s`
      select contrato_id, propietario_id, tipo, periodo::text as periodo, monto::float8 as monto,
             fecha_limite::text as fecha_limite, creado_por
      from cargos`)
    expect(filas).toHaveLength(1)
    expect(filas[0]).toMatchObject({
      contrato_id: c,
      propietario_id: u.propietarioA,
      tipo: 'renta',
      periodo: '2026-03-01',
      monto: 10000,
      fecha_limite: '2026-03-05',
      creado_por: u.equipo,
    })
  })

  test('generar_cargos_renta normaliza el periodo y respeta la vigencia y el estatus del contrato', async () => {
    await contrato() // vigente 2026
    await contrato({ estatus: 'terminado' })
    await contrato({ estatus: 'pendiente_firma', pendiente_firma_desde: '2026-02-01' })
    await contrato({ fecha_inicio: '2026-04-01', fecha_fin: '2026-12-31' }) // empieza después
    await contrato({ fecha_inicio: '2025-01-01', fecha_fin: '2026-02-28' }) // ya terminó

    const [r] = await asUser(u.equipo, (s) => s`select generar_cargos_renta('2026-03-17') as n`)
    expect(r.n).toBe(1)
    const [c] = await sqlAdmin`select periodo::text as periodo from cargos`
    expect(c.periodo).toBe('2026-03-01')
  })

  test('pago parcial: estatus parcial y saldo 6000', async () => {
    const c = await contrato()
    const cargo = await cargoConLimite(c, 10000, 3)
    const pagoId = await pagar([cargo], 4000)

    expect(await vCargo(cargo)).toMatchObject({
      monto: 10000, pagado: 4000, saldo: 6000, estatus: 'parcial', dias_atraso: 0,
    })
    const [p] = await sqlAdmin`select propietario_id, monto::float8 as monto, registrado_por, cancelado
      from pagos where id = ${pagoId}`
    expect(p).toMatchObject({
      propietario_id: u.propietarioA, monto: 4000, registrado_por: u.equipo, cancelado: false,
    })
  })

  test('pago adelantado de dos meses: ambos cargos pagados', async () => {
    const c = await contrato()
    await asUser(u.equipo, async (s) => {
      await s`select generar_cargos_renta('2026-03-01')`
      await s`select generar_cargos_renta('2026-04-01')`
    })
    const mar = await cargoDe(c, '2026-03-01')
    const abr = await cargoDe(c, '2026-04-01')
    const pagoId = await pagar([mar, abr], 20000)

    expect(await vCargo(mar)).toMatchObject({ pagado: 10000, saldo: 0, estatus: 'pagado', dias_atraso: 0 })
    expect(await vCargo(abr)).toMatchObject({ pagado: 10000, saldo: 0, estatus: 'pagado', dias_atraso: 0 })
    const apps = await sqlAdmin`select count(*)::int as n from pago_aplicaciones where pago_id = ${pagoId}`
    expect(apps[0].n).toBe(2)
  })

  test('registrar_pago aplica en el orden dado', async () => {
    const c = await contrato()
    await asUser(u.equipo, async (s) => {
      await s`select generar_cargos_renta('2026-03-01')`
      await s`select generar_cargos_renta('2026-04-01')`
    })
    const mar = await cargoDe(c, '2026-03-01')
    const abr = await cargoDe(c, '2026-04-01')
    await pagar([abr, mar], 13000)

    expect((await vCargo(abr)).saldo).toBe(0)
    expect((await vCargo(mar)).saldo).toBe(7000)
  })

  test('vencido: fecha_limite hace 10 días sin pago', async () => {
    const c = await contrato()
    const cargo = await cargoConLimite(c, 10000, -10)
    expect(await vCargo(cargo)).toMatchObject({ saldo: 10000, estatus: 'vencido', dias_atraso: 10 })
  })

  test('sobrepago: MONTO_EXCEDE_SALDO y no se registra nada', async () => {
    const c = await contrato()
    await asUser(u.equipo, (s) => s`select generar_cargos_renta('2026-03-01')`)
    const cargo = await cargoDe(c, '2026-03-01')
    await expect(pagar([cargo], 12000)).rejects.toThrow(/MONTO_EXCEDE_SALDO/)
    const [n] = await sqlAdmin`select count(*)::int as n from pagos`
    expect(n.n).toBe(0)
  })

  test('registrar_pago valida monto, rol y un solo propietario', async () => {
    const cA = await contrato()
    const cB = await contrato({ propietario: u.propietarioB })
    await asUser(u.equipo, (s) => s`select generar_cargos_renta('2026-03-01')`)
    const a = await cargoDe(cA, '2026-03-01')
    const b = await cargoDe(cB, '2026-03-01')

    await expect(pagar([a, b], 20000)).rejects.toThrow(/CARGOS_DE_VARIOS_PROPIETARIOS/)
    await expect(pagar([a], 0)).rejects.toThrow(/MONTO_INVALIDO/)
    await expect(pagar([a], 100, '', u.propA)).rejects.toThrow(/SOLO_EQUIPO/)
  })

  test('doble captura: misma referencia y propietario falla por unique', async () => {
    const c = await contrato()
    await asUser(u.equipo, (s) => s`select generar_cargos_renta('2026-03-01')`)
    const cargo = await cargoDe(c, '2026-03-01')
    const p1 = await pagar([cargo], 1000, 'REF-1')
    await expect(pagar([cargo], 1000, 'REF-1')).rejects.toThrow(UNIQUE)

    // Referencias vacías no chocan entre sí; tras cancelar, la referencia se libera.
    await pagar([cargo], 500)
    await pagar([cargo], 500)
    await asUser(u.equipo, (s) => s`select cancelar_pago(${p1}, 'capturado dos veces')`)
    await pagar([cargo], 1000, 'REF-1')
  })

  test('cancelar_pago marca cancelado y el cargo vuelve a pendiente; equipo no borra pagos', async () => {
    const c = await contrato()
    const cargo = await cargoConLimite(c, 10000, 3)
    const pagoId = await pagar([cargo], 10000)
    expect((await vCargo(cargo)).estatus).toBe('pagado')

    await expect(
      asUser(u.equipo, (s) => s`select cancelar_pago(${pagoId}, '  ')`),
    ).rejects.toThrow(/MOTIVO_REQUERIDO/)

    await asUser(u.equipo, (s) => s`select cancelar_pago(${pagoId}, 'cheque rebotado')`)
    const [p] = await sqlAdmin`select cancelado, cancelado_motivo, cancelado_por, cancelado_at from pagos where id = ${pagoId}`
    expect(p.cancelado).toBe(true)
    expect(p.cancelado_motivo).toBe('cheque rebotado')
    expect(p.cancelado_por).toBe(u.equipo)
    expect(p.cancelado_at).not.toBeNull()
    expect(await vCargo(cargo)).toMatchObject({ pagado: 0, saldo: 10000, estatus: 'pendiente' })

    await expect(
      asUser(u.equipo, (s) => s`select cancelar_pago(${pagoId}, 'otra vez')`),
    ).rejects.toThrow(/PAGO_CANCELADO/)

    await expect(
      asUser(u.equipo, (s) => s`delete from pagos where id = ${pagoId}`),
    ).rejects.toThrow(RLS)
    await expect(
      asUser(u.equipo, (s) => s`update pagos set cancelado = false where id = ${pagoId}`),
    ).rejects.toThrow(RLS)
    const [n] = await sqlAdmin`select count(*)::int as n from pagos`
    expect(n.n).toBe(1)
  })

  test('contrato a mitad de mes: renta completa; actualizar_monto_cargo hasta que hay pagos', async () => {
    const c = await contrato({ fecha_inicio: '2026-03-15', fecha_fin: '2027-03-14' })
    const [r] = await asUser(u.equipo, (s) => s`select generar_cargos_renta('2026-03-01') as n`)
    expect(r.n).toBe(1)
    const cargo = await cargoDe(c, '2026-03-01')
    expect((await vCargo(cargo)).monto).toBe(10000)

    await asUser(u.equipo, (s) => s`select actualizar_monto_cargo(${cargo}, 5000)`)
    expect((await vCargo(cargo)).monto).toBe(5000)

    await pagar([cargo], 1000)
    await expect(
      asUser(u.equipo, (s) => s`select actualizar_monto_cargo(${cargo}, 6000)`),
    ).rejects.toThrow(/CARGO_CON_PAGOS/)
    expect((await vCargo(cargo)).monto).toBe(5000)
  })

  test('v_contratos: por_vencer, pendiente_firma, vencido, terminado, vigente e inquilino_nombre', async () => {
    const [d] = await sqlAdmin`select (current_date + 30)::text as en30, (current_date + 61)::text as en61,
      (current_date - 1)::text as ayer, (current_date - 400)::text as hace400, current_date::text as hoy`
    const porVencer = await contrato({ fecha_inicio: d.hace400, fecha_fin: d.en30 })
    const pendiente = await contrato({
      fecha_inicio: d.hoy, fecha_fin: d.en61, estatus: 'pendiente_firma', pendiente_firma_desde: d.hoy,
    })
    const vencido = await contrato({ fecha_inicio: d.hace400, fecha_fin: d.ayer })
    const terminado = await contrato({ fecha_inicio: d.hace400, fecha_fin: d.ayer, estatus: 'terminado' })
    const vigente = await contrato({ fecha_inicio: d.hoy, fecha_fin: d.en61 })

    const filas = await asUser(u.equipo, (s) => s`select id, estatus_calc, inquilino_nombre, renta_mensual from v_contratos`)
    const por = Object.fromEntries(filas.map((f) => [f.id, f.estatus_calc]))
    expect(por[porVencer]).toBe('por_vencer')
    expect(por[pendiente]).toBe('pendiente_firma')
    expect(por[vencido]).toBe('vencido')
    expect(por[terminado]).toBe('terminado')
    expect(por[vigente]).toBe('vigente')
    expect(filas.every((f) => f.inquilino_nombre === 'Juan Pérez')).toBe(true)
  })

  describe('RLS', () => {
    test('equipo ve cargos; inserta recargo/otro pero no renta; sólo edita notas', async () => {
      const c = await contrato()
      await asUser(u.equipo, (s) => s`select generar_cargos_renta('2026-03-01')`)
      const cargo = await cargoDe(c, '2026-03-01')

      const vistos = await asUser(u.equipo, (s) => s`select id from cargos`)
      expect(vistos).toHaveLength(1)

      await asUser(u.equipo, (s) => s`insert into cargos (contrato_id, tipo, periodo, monto, fecha_limite)
        values (${c}, 'recargo', '2026-03-01', 500, '2026-03-10')`)
      await expect(
        asUser(u.equipo, (s) => s`insert into cargos (contrato_id, tipo, periodo, monto, fecha_limite)
          values (${c}, 'renta', '2026-05-01', 10000, '2026-05-05')`),
      ).rejects.toThrow(RLS)

      await asUser(u.equipo, (s) => s`update cargos set notas = 'llamó el inquilino' where id = ${cargo}`)
      const [n] = await sqlAdmin`select notas from cargos where id = ${cargo}`
      expect(n.notas).toBe('llamó el inquilino')

      await expect(
        asUser(u.equipo, (s) => s`update cargos set monto = 1 where id = ${cargo}`),
      ).rejects.toThrow(/SOLO_NOTAS/)
    })

    test('equipo no inserta pagos ni aplicaciones directamente', async () => {
      await expect(
        asUser(u.equipo, (s) => s`insert into pagos (propietario_id, fecha, monto, metodo, cuenta_destino)
          values (${u.propietarioA}, current_date, 100, 'efectivo', 'disa')`),
      ).rejects.toThrow(RLS)
    })

    test('propietario no ve cargos, pagos ni aplicaciones, ni ejecuta funciones de cobranza', async () => {
      const c = await contrato()
      await asUser(u.equipo, (s) => s`select generar_cargos_renta('2026-03-01')`)
      await pagar([await cargoDe(c, '2026-03-01')], 1000)

      expect(await asUser(u.propA, (s) => s`select * from cargos`)).toEqual([])
      expect(await asUser(u.propA, (s) => s`select * from pagos`)).toEqual([])
      expect(await asUser(u.propA, (s) => s`select * from pago_aplicaciones`)).toEqual([])
      expect(await asUser(u.propA, (s) => s`select * from v_cargos`)).toEqual([])
      await expect(
        asUser(u.propA, (s) => s`select generar_cargos_renta('2026-04-01')`),
      ).rejects.toThrow(/SOLO_EQUIPO/)
    })

    test('admin no inserta pagos ni aplicaciones directamente; registrar_pago sí funciona', async () => {
      const c = await contrato()
      await asUser(u.equipo, (s) => s`select generar_cargos_renta('2026-03-01')`)
      const cargo = await cargoDe(c, '2026-03-01')

      await expect(
        asUser(u.admin, (s) => s`insert into pagos (propietario_id, fecha, monto, metodo, cuenta_destino)
          values (${u.propietarioA}, current_date, 100, 'efectivo', 'disa')`),
      ).rejects.toThrow(/permission denied/)

      const pagoId = await pagar([cargo], 4000, 'REF-ADMIN', u.admin)
      await expect(
        asUser(u.admin, (s) => s`insert into pago_aplicaciones (pago_id, cargo_id, monto)
          values (${pagoId}, ${cargo}, 6000)`),
      ).rejects.toThrow(/permission denied/)

      const [p] = await sqlAdmin`select registrado_por from pagos where id = ${pagoId}`
      expect(p.registrado_por).toBe(u.admin)
      expect(await vCargo(cargo)).toMatchObject({ pagado: 4000, saldo: 6000 })
    })

    test('admin puede todo en cargos', async () => {
      const c = await contrato()
      await asUser(u.admin, (s) => s`insert into cargos (contrato_id, tipo, periodo, monto, fecha_limite)
        values (${c}, 'renta', '2026-05-01', 10000, '2026-05-05')`)
      await asUser(u.admin, (s) => s`update cargos set monto = 9000`)
      const [r] = await sqlAdmin`select monto::float8 as monto, propietario_id from cargos`
      expect(r).toMatchObject({ monto: 9000, propietario_id: u.propietarioA })
    })
  })
})
