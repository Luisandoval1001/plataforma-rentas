import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { asUser, closeDb, resetDb, seedUsuarios, sqlAdmin } from './harness'

const RLS = /row-level security|permission denied/
const UNIQUE = /duplicate key value violates unique constraint/
const SISTEMA = '00000000-0000-0000-0000-000000000001'

type Fixture = { inmueble: string; unidad: string; inquilino: string; contrato: string }

describe('bitácora, documentos, avisos y vistas del portal (0004_bitacora_docs)', () => {
  let u: Awaited<ReturnType<typeof seedUsuarios>>

  /** Inmueble + unidad + inquilino + contrato vigente que cubre hoy (renta 10,000, día 5). */
  async function fixture(propietario: string, unidad = 'Depto 101'): Promise<Fixture> {
    const [inm] = await sqlAdmin`insert into inmuebles (propietario_id, nombre, direccion, tipo)
      values (${propietario}, 'Torre', 'Av. 1', 'edificio') returning id`
    const [uni] = await sqlAdmin`insert into unidades (inmueble_id, nombre)
      values (${inm.id}, ${unidad}) returning id`
    const [inq] = await sqlAdmin`insert into inquilinos (nombre, email, telefono)
      values ('Juan Pérez', 'juan@correo.mx', '5555555555') returning id`
    const [c] = await sqlAdmin`insert into contratos
      (unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago, deposito, pdf_path)
      values (${uni.id}, ${inq.id}, current_date - 90, current_date + 300, 10000, 5, 20000, 'contratos/c.pdf')
      returning id`
    return { inmueble: inm.id, unidad: uni.id, inquilino: inq.id, contrato: c.id }
  }

  /** Unidad sin contrato en un inmueble existente. */
  async function unidadSola(inmuebleId: string, nombre: string): Promise<string> {
    const [uni] = await sqlAdmin`insert into unidades (inmueble_id, nombre)
      values (${inmuebleId}, ${nombre}) returning id`
    return uni.id
  }

  /**
   * Cargo del mes en curso (o de mesesAtras meses antes), con notas internas. fecha_limite: día 5
   * del periodo, o current_date + limiteEnDias si se da (para fijar el estatus en cualquier fecha).
   */
  async function cargo(
    contratoId: string,
    tipo: 'renta' | 'recargo' | 'otro' = 'renta',
    monto = 10000,
    mesesAtras = 0,
    limiteEnDias: number | null = null,
  ): Promise<string> {
    const [c] = await sqlAdmin`insert into cargos (contrato_id, tipo, periodo, monto, fecha_limite, notas)
      values (${contratoId}, ${tipo},
              (date_trunc('month', current_date) - make_interval(months => ${mesesAtras}::int))::date,
              ${monto},
              coalesce(current_date + ${limiteEnDias}::int,
                (date_trunc('month', current_date) - make_interval(months => ${mesesAtras}::int))::date + 4),
              'nota interna')
      returning id`
    return c.id
  }

  /** Día `dia` (1 = primero) del mes que está mesesAtras meses antes del actual. */
  async function diaDelMes(mesesAtras: number, dia: number): Promise<string> {
    const [r] = await sqlAdmin`select ((date_trunc('month', current_date)
      - make_interval(months => ${mesesAtras}::int))::date + ${dia - 1}::int)::text as d`
    return r.d as string
  }

  function pagar(cargos: string[], monto: number, fecha: string, referencia: string): Promise<string> {
    return asUser(u.equipo, async (s) => {
      const [r] = await s`select registrar_pago(
        ${cargos}::uuid[], ${monto}, ${fecha}, 'transferencia', ${referencia}, 'disa', null
      ) as id`
      return r.id as string
    })
  }

  async function hoyMenos(dias: number): Promise<string> {
    const [r] = await sqlAdmin`select (current_date - ${dias}::int)::text as d`
    return r.d as string
  }

  async function columnas(vista: string): Promise<string[]> {
    const rs = await sqlAdmin`select column_name from information_schema.columns
      where table_schema = 'public' and table_name = ${vista} order by ordinal_position`
    return rs.map((r) => r.column_name as string)
  }

  beforeAll(async () => {
    await resetDb()
  })
  beforeEach(async () => {
    await sqlAdmin`truncate avisos_enviados, documentos, liquidacion_lineas, ajustes_pendientes,
      liquidaciones, gastos, pago_aplicaciones, pagos, cargos, contratos, unidades, inquilinos,
      inmuebles cascade`
    u = await seedUsuarios()
    await sqlAdmin`update propietarios set recargo_visible = false, recargos_al_propietario = false`
  })
  afterAll(async () => {
    await closeDb()
  })

  describe('bitácora', () => {
    test('registrar_pago como equipo → INSERT en pagos con usuario_id = equipo; cancelar_pago → UPDATE', async () => {
      const a = await fixture(u.propietarioA)
      const c = await cargo(a.contrato)
      const pago = await pagar([c], 10000, await hoyMenos(1), 'REF-1')

      const ins = await sqlAdmin`select tabla, accion, usuario_id, antes, despues
        from bitacora where registro_id = ${pago} order by id`
      expect(ins).toHaveLength(1)
      expect(ins[0]).toMatchObject({ tabla: 'pagos', accion: 'INSERT', usuario_id: u.equipo, antes: null })
      expect(ins[0].despues).toMatchObject({ id: pago, monto: 10000, cancelado: false })

      // La aplicación del pago también queda registrada.
      const apl = await sqlAdmin`select b.usuario_id from bitacora b
        join pago_aplicaciones pa on pa.id = b.registro_id
        where b.tabla = 'pago_aplicaciones' and b.accion = 'INSERT' and pa.pago_id = ${pago}`
      expect(apl).toEqual([{ usuario_id: u.equipo }])

      await asUser(u.equipo, (s) => s`select cancelar_pago(${pago}, 'Rebotó')`)
      const upd = await sqlAdmin`select usuario_id, antes, despues from bitacora
        where registro_id = ${pago} and accion = 'UPDATE'`
      expect(upd).toHaveLength(1)
      expect(upd[0].usuario_id).toBe(u.equipo)
      expect(upd[0].antes.cancelado).toBe(false)
      expect(upd[0].despues.cancelado).toBe(true)
    })

    test('registra contratos, cargos, gastos y liquidaciones; usuario_id nulo fuera de sesión', async () => {
      const a = await fixture(u.propietarioA)
      const c = await cargo(a.contrato)
      const [g] = await asUser(u.equipo, (s) => s`insert into gastos (inmueble_id, fecha, concepto, monto, pagado_por)
        values (${a.inmueble}, current_date, 'Pintura', 100, 'disa') returning id`)
      await asUser(u.admin, (s) => s`delete from gastos where id = ${g.id}`)
      const liq = await asUser(u.equipo, async (s) => {
        const [r] = await s`select preparar_liquidacion(${u.propietarioA}, current_date) as id`
        return r.id as string
      })

      const rs = await sqlAdmin`select tabla, accion, usuario_id from bitacora
        where registro_id in (${a.contrato}, ${c}, ${g.id}, ${liq}) order by id`
      expect(rs).toEqual([
        { tabla: 'contratos', accion: 'INSERT', usuario_id: null },
        { tabla: 'cargos', accion: 'INSERT', usuario_id: null },
        { tabla: 'gastos', accion: 'INSERT', usuario_id: u.equipo },
        { tabla: 'gastos', accion: 'DELETE', usuario_id: u.admin },
        { tabla: 'liquidaciones', accion: 'INSERT', usuario_id: u.equipo },
        { tabla: 'liquidaciones', accion: 'UPDATE', usuario_id: u.equipo },
      ])
      const [del] = await sqlAdmin`select antes, despues from bitacora
        where registro_id = ${g.id} and accion = 'DELETE'`
      expect(del.antes).toMatchObject({ id: g.id, concepto: 'Pintura' })
      expect(del.despues).toBeNull()
    })

    test('admin y equipo leen la bitácora; propietario no', async () => {
      await fixture(u.propietarioA)
      expect((await asUser(u.admin, (s) => s`select id from bitacora`)).length).toBeGreaterThan(0)
      expect((await asUser(u.equipo, (s) => s`select id from bitacora`)).length).toBeGreaterThan(0)
      expect(await asUser(u.propA, (s) => s`select * from bitacora`)).toEqual([])
    })

    test('nadie inserta, modifica ni borra la bitácora desde la app', async () => {
      await fixture(u.propietarioA)
      await expect(
        asUser(u.admin, (s) => s`update bitacora set accion = 'X'`),
      ).rejects.toThrow(RLS)
      await expect(asUser(u.admin, (s) => s`delete from bitacora`)).rejects.toThrow(RLS)
      await expect(
        asUser(u.admin, (s) => s`insert into bitacora (tabla, accion) values ('x', 'INSERT')`),
      ).rejects.toThrow(RLS)
      await expect(asUser(u.equipo, (s) => s`delete from bitacora`)).rejects.toThrow(RLS)
    })

    test('ni el dueño de la tabla la modifica: BITACORA_INMUTABLE', async () => {
      await fixture(u.propietarioA)
      await expect(sqlAdmin`delete from bitacora`).rejects.toThrow(/BITACORA_INMUTABLE/)
      await expect(sqlAdmin`update bitacora set accion = 'X'`).rejects.toThrow(/BITACORA_INMUTABLE/)
      await expect(sqlAdmin`truncate bitacora`).rejects.toThrow(/BITACORA_INMUTABLE/)
    })
  })

  describe('portal_resumen_unidades', () => {
    test('propA ve sólo sus unidades; propB sólo las suyas; equipo y admin nada', async () => {
      const a = await fixture(u.propietarioA, 'A-101')
      const b = await fixture(u.propietarioB, 'B-201')
      await cargo(a.contrato)
      await cargo(b.contrato)

      const ra = await asUser(u.propA, (s) => s`select propietario_id, unidad_nombre from portal_resumen_unidades`)
      expect(ra).toEqual([{ propietario_id: u.propietarioA, unidad_nombre: 'A-101' }])
      const rb = await asUser(u.propB, (s) => s`select propietario_id, unidad_nombre from portal_resumen_unidades`)
      expect(rb).toEqual([{ propietario_id: u.propietarioB, unidad_nombre: 'B-201' }])

      expect(await asUser(u.equipo, (s) => s`select * from portal_resumen_unidades`)).toEqual([])
      expect(await asUser(u.admin, (s) => s`select * from portal_resumen_unidades`)).toEqual([])
    })

    test('cargo del mes en curso con pagado, saldo, estatus y último pago; unidad sin cargo aparece una vez', async () => {
      const a = await fixture(u.propietarioA, 'A-101')
      const vacia = await unidadSola(a.inmueble, 'A-102')
      const c = await cargo(a.contrato, 'renta', 10000, 0, 10) // vence en 10 días: 'parcial'
      await cargo(a.contrato, 'renta', 10000, 1) // mes anterior: no aparece
      const f1 = await hoyMenos(3)
      const f2 = await hoyMenos(1)
      await pagar([c], 3000, f1, 'R1')
      await pagar([c], 2000, f2, 'R2')
      const cancelado = await pagar([c], 1000, await hoyMenos(0), 'R3')
      await asUser(u.equipo, (s) => s`select cancelar_pago(${cancelado}, 'error')`)

      const rs = await asUser(u.propA, (s) => s`
        select unidad_id, unidad_nombre, inmueble_id, inmueble_nombre, contrato_id, inquilino_nombre,
               cargo_id, tipo, monto::float8 as monto, pagado::float8 as pagado, saldo::float8 as saldo,
               estatus, ultimo_pago_fecha::text as ultimo_pago_fecha
        from portal_resumen_unidades order by unidad_nombre`)
      expect(rs).toHaveLength(2)
      expect(rs[0]).toMatchObject({
        unidad_id: a.unidad,
        unidad_nombre: 'A-101',
        inmueble_id: a.inmueble,
        inmueble_nombre: 'Torre',
        contrato_id: a.contrato,
        inquilino_nombre: 'Juan Pérez',
        cargo_id: c,
        tipo: 'renta',
        monto: 10000,
        pagado: 5000,
        saldo: 5000,
        ultimo_pago_fecha: f2,
        estatus: 'parcial',
      })

      // Mismo cálculo que v_cargos (la vista del portal lo repite).
      const [v] = await asUser(u.equipo, (s) => s`select pagado::float8 as pagado, saldo::float8 as saldo,
        estatus, dias_atraso from v_cargos where id = ${c}`)
      const [p] = await asUser(u.propA, (s) => s`select pagado::float8 as pagado, saldo::float8 as saldo,
        estatus, dias_atraso from portal_resumen_unidades where cargo_id = ${c}`)
      expect(p).toEqual(v)
      expect(rs[1]).toMatchObject({
        unidad_id: vacia,
        unidad_nombre: 'A-102',
        contrato_id: null,
        inquilino_nombre: null,
        cargo_id: null,
        monto: null,
        ultimo_pago_fecha: null,
      })
    })

    test('tras transferir la unidad, el nuevo dueño no ve contrato ni inquilino del anterior', async () => {
      const a = await fixture(u.propietarioA, 'A-101')
      await sqlAdmin`update inmuebles set propietario_id = ${u.propietarioB} where id = ${a.inmueble}`
      // El contrato se propaga (0001); se simula un contrato que conserva al dueño anterior.
      await sqlAdmin`alter table contratos disable trigger contratos_propietario`
      try {
        await sqlAdmin`update contratos set propietario_id = ${u.propietarioA} where id = ${a.contrato}`
      } finally {
        await sqlAdmin`alter table contratos enable trigger contratos_propietario`
      }
      const rs = await asUser(u.propB, (s) => s`select unidad_id, contrato_id, inquilino_nombre
        from portal_resumen_unidades`)
      expect(rs).toEqual([{ unidad_id: a.unidad, contrato_id: null, inquilino_nombre: null }])
    })

    test('recargo_visible=false omite recargos; true los incluye', async () => {
      const a = await fixture(u.propietarioA)
      await cargo(a.contrato, 'renta')
      await cargo(a.contrato, 'recargo', 500)

      const tipos = async () =>
        (await asUser(u.propA, (s) => s`select tipo from portal_resumen_unidades order by tipo`)).map(
          (r) => r.tipo,
        )
      expect(await tipos()).toEqual(['renta'])

      await sqlAdmin`update propietarios set recargo_visible = true where id = ${u.propietarioA}`
      expect(await tipos()).toEqual(['renta', 'recargo'])
    })

    test('no expone notas, creado_por ni registrado_por', async () => {
      const cols = await columnas('portal_resumen_unidades')
      expect(cols).toEqual([
        'propietario_id', 'inmueble_id', 'inmueble_nombre', 'unidad_id', 'unidad_nombre',
        'contrato_id', 'inquilino_nombre', 'cargo_id', 'tipo', 'monto', 'fecha_limite',
        'pagado', 'saldo', 'estatus', 'dias_atraso', 'ultimo_pago_fecha',
      ])
      expect(cols).not.toContain('notas')
      expect(cols).not.toContain('creado_por')
      expect(cols).not.toContain('registrado_por')
    })
  })

  describe('portal_contratos y portal_propietario', () => {
    test('portal_contratos: sólo lo propio, sin contacto del inquilino', async () => {
      const a = await fixture(u.propietarioA, 'A-101')
      await fixture(u.propietarioB, 'B-201')

      const rs = await asUser(u.propA, (s) => s`select contrato_id, unidad_nombre, inmueble_nombre,
        inquilino_nombre, renta_mensual::float8 as renta_mensual, deposito::float8 as deposito,
        dia_pago, estatus_calc, pdf_path from portal_contratos`)
      expect(rs).toEqual([{
        contrato_id: a.contrato, unidad_nombre: 'A-101', inmueble_nombre: 'Torre',
        inquilino_nombre: 'Juan Pérez', renta_mensual: 10000, deposito: 20000, dia_pago: 5,
        estatus_calc: 'vigente', pdf_path: 'contratos/c.pdf',
      }])
      expect(await asUser(u.equipo, (s) => s`select * from portal_contratos`)).toEqual([])

      // estatus_calc igual que v_contratos para cada estatus.
      await sqlAdmin`update contratos set fecha_fin = current_date + 30 where id = ${a.contrato}`
      const [v] = await asUser(u.equipo, (s) => s`select estatus_calc from v_contratos where id = ${a.contrato}`)
      const [p] = await asUser(u.propA, (s) => s`select estatus_calc from portal_contratos`)
      expect(p).toEqual(v)
      expect(p.estatus_calc).toBe('por_vencer')

      const cols = await columnas('portal_contratos')
      expect(cols).toEqual([
        'propietario_id', 'contrato_id', 'unidad_id', 'unidad_nombre', 'inmueble_nombre',
        'inquilino_nombre', 'fecha_inicio', 'fecha_fin', 'renta_mensual', 'deposito', 'dia_pago',
        'estatus_calc', 'pdf_path', 'renta_actual',
      ])
      for (const c of ['inquilino_id', 'email', 'telefono', 'rfc']) expect(cols).not.toContain(c)
    })

    test('portal_propietario: sólo el propio renglón con preferencias', async () => {
      const rs = await asUser(u.propA, (s) => s`select * from portal_propietario`)
      expect(rs).toHaveLength(1)
      expect(rs[0]).toMatchObject({
        id: u.propietarioA, nombre: 'A', idioma: 'es', avisos_pago: true,
        avisos_estado_cuenta: true, avisos_contrato: true, modelo: 'cobra_disa',
      })
      expect(Object.keys(rs[0])).toEqual([
        'id', 'nombre', 'idioma', 'avisos_pago', 'avisos_estado_cuenta', 'avisos_contrato',
        'modelo', 'comision_pct',
      ])
      expect(await asUser(u.equipo, (s) => s`select * from portal_propietario`)).toEqual([])
    })
  })

  describe('portal_liquidaciones y portal_liquidacion_lineas', () => {
    test('sólo cerradas/pagadas y del propio propietario', async () => {
      const a = await fixture(u.propietarioA)
      const c = await cargo(a.contrato, 'renta', 10000, 2)
      await pagar([c], 10000, await diaDelMes(2, 10), 'REF-ANT')

      const anterior = await asUser(u.equipo, async (s) => {
        const [r] = await s`select preparar_liquidacion(${u.propietarioA},
          (date_trunc('month', current_date) - interval '2 months')::date) as id`
        return r.id as string
      })
      await asUser(u.admin, (s) => s`select cerrar_liquidacion(${anterior})`)
      const borrador = await asUser(u.equipo, async (s) => {
        const [r] = await s`select preparar_liquidacion(${u.propietarioA}, current_date) as id`
        return r.id as string
      })
      expect(borrador).not.toBe(anterior)

      const rs = await asUser(u.propA, (s) => s`select id, estatus, cobrado::float8 as cobrado
        from portal_liquidaciones`)
      expect(rs).toEqual([{ id: anterior, estatus: 'cerrada', cobrado: 10000 }])

      const ls = await asUser(u.propA, (s) => s`select liquidacion_id, propietario_id, tipo, monto::float8 as monto
        from portal_liquidacion_lineas`)
      expect(ls).toEqual([{ liquidacion_id: anterior, propietario_id: u.propietarioA, tipo: 'cobro', monto: 10000 }])

      expect(await asUser(u.propB, (s) => s`select * from portal_liquidaciones`)).toEqual([])
      expect(await asUser(u.propB, (s) => s`select * from portal_liquidacion_lineas`)).toEqual([])
      expect(await asUser(u.equipo, (s) => s`select * from portal_liquidaciones`)).toEqual([])
      expect(await asUser(u.equipo, (s) => s`select * from portal_liquidacion_lineas`)).toEqual([])

      const cols = await columnas('portal_liquidaciones')
      expect(cols).not.toContain('cerrada_por')
      expect(cols).toContain('pdf_path')
      expect(cols).toContain('neto')
    })
  })

  describe('documentos y portal_documentos', () => {
    async function documento(propietario: string, visible: boolean, nombre = 'Factura marzo') {
      return asUser(u.equipo, async (s) => {
        const [d] = await s`insert into documentos (propietario_id, tipo, nombre, path, visible_propietario)
          values (${propietario}, 'factura', ${nombre}, 'docs/f.pdf', ${visible}) returning id, subido_por`
        return d as { id: string; subido_por: string }
      })
    }

    test('equipo sube documentos (subido_por = equipo); propietario sólo ve los visibles vía portal', async () => {
      const visible = await documento(u.propietarioA, true)
      await documento(u.propietarioA, false, 'Interno')
      await documento(u.propietarioB, true, 'De B')
      expect(visible.subido_por).toBe(u.equipo)

      const rs = await asUser(u.propA, (s) => s`select * from portal_documentos`)
      expect(rs.map((r) => r.id)).toEqual([visible.id])
      expect(Object.keys(rs[0])).toEqual([
        'id', 'propietario_id', 'tipo', 'nombre', 'path', 'unidad_id', 'liquidacion_id', 'created_at',
      ])
      expect(await asUser(u.propA, (s) => s`select * from documentos`)).toEqual([])
      expect(await asUser(u.equipo, (s) => s`select * from portal_documentos`)).toEqual([])
      expect(await asUser(u.equipo, (s) => s`select id from documentos`)).toHaveLength(3)
      await expect(
        asUser(u.propA, (s) => s`insert into documentos (propietario_id, tipo, nombre, path)
          values (${u.propietarioA}, 'otro', 'x', 'x')`),
      ).rejects.toThrow(RLS)
    })

    test('equipo sólo cambia metadatos; sólo admin borra', async () => {
      const d = await documento(u.propietarioA, true)
      await asUser(u.equipo, (s) => s`update documentos
        set nombre = 'Factura 03', tipo = 'comprobante', visible_propietario = false where id = ${d.id}`)
      const [r] = await sqlAdmin`select nombre, tipo, visible_propietario from documentos where id = ${d.id}`
      expect(r).toEqual({ nombre: 'Factura 03', tipo: 'comprobante', visible_propietario: false })

      await expect(
        asUser(u.equipo, (s) => s`update documentos set path = 'otro.pdf' where id = ${d.id}`),
      ).rejects.toThrow(/SOLO_METADATOS/)
      await expect(
        asUser(u.equipo, (s) => s`update documentos set propietario_id = ${u.propietarioB} where id = ${d.id}`),
      ).rejects.toThrow(/SOLO_METADATOS/)
      await expect(
        asUser(u.equipo, (s) => s`delete from documentos where id = ${d.id}`),
      ).rejects.toThrow(/SOLO_ADMIN/)

      await asUser(u.admin, (s) => s`update documentos set path = 'nuevo.pdf' where id = ${d.id}`)
      await asUser(u.admin, (s) => s`delete from documentos where id = ${d.id}`)
      const [n] = await sqlAdmin`select count(*)::int as n from documentos`
      expect(n.n).toBe(0)
    })

    test('subido_por lo fija la sesión aunque el cliente mande otro', async () => {
      const [d] = await asUser(u.equipo, (s) => s`insert into documentos
        (propietario_id, tipo, nombre, path, subido_por)
        values (${u.propietarioA}, 'otro', 'x', 'x', ${u.admin}) returning subido_por`)
      expect(d.subido_por).toBe(u.equipo)
    })

    test('ligas a unidad/pago/liquidación de otro propietario: DOCUMENTO_DE_OTRO_PROPIETARIO', async () => {
      const b = await fixture(u.propietarioB)
      await expect(
        asUser(u.equipo, (s) => s`insert into documentos (propietario_id, tipo, nombre, path, unidad_id)
          values (${u.propietarioA}, 'otro', 'x', 'x', ${b.unidad})`),
      ).rejects.toThrow(/DOCUMENTO_DE_OTRO_PROPIETARIO/)
      const cb = await cargo(b.contrato)
      const pagoB = await pagar([cb], 10000, await diaDelMes(0, 1), 'REF-B')
      await expect(
        asUser(u.equipo, (s) => s`insert into documentos (propietario_id, tipo, nombre, path, pago_id)
          values (${u.propietarioA}, 'comprobante', 'x', 'x', ${pagoB})`),
      ).rejects.toThrow(/DOCUMENTO_DE_OTRO_PROPIETARIO/)
      // Con el propietario correcto sí se permite.
      await asUser(u.equipo, (s) => s`insert into documentos (propietario_id, tipo, nombre, path, unidad_id, pago_id)
        values (${u.propietarioB}, 'comprobante', 'x', 'x', ${b.unidad}, ${pagoB})`)
    })

    test('documento ligado a una liquidación en borrador no aparece en el portal hasta cerrarla', async () => {
      await fixture(u.propietarioA)
      const liq = await asUser(u.equipo, async (s) => {
        // Mes anterior: el mes en curso no se puede cerrar (PERIODO_EN_CURSO).
        const [r] = await s`select preparar_liquidacion(${u.propietarioA},
          (date_trunc('month', current_date) - interval '1 month')::date) as id`
        return r.id as string
      })
      const [d] = await asUser(u.equipo, (s) => s`insert into documentos
        (propietario_id, tipo, nombre, path, liquidacion_id)
        values (${u.propietarioA}, 'reporte', 'Estado de cuenta', 'x.pdf', ${liq}) returning id`)
      expect(await asUser(u.propA, (s) => s`select id from portal_documentos`)).toEqual([])

      await asUser(u.admin, (s) => s`select cerrar_liquidacion(${liq})`)
      expect(await asUser(u.propA, (s) => s`select id from portal_documentos`)).toEqual([{ id: d.id }])
    })

    test('propietario_id es obligatorio', async () => {
      await expect(
        asUser(u.equipo, (s) => s`insert into documentos (tipo, nombre, path) values ('otro', 'x', 'x')`),
      ).rejects.toThrow(/null value/)
    })
  })

  describe('avisos_enviados, usuario sistema y ref_carga', () => {
    test('avisos: admin/equipo insertan y leen; (tipo, referencia_id) único; propietario no ve', async () => {
      const a = await fixture(u.propietarioA)
      await asUser(u.admin, (s) => s`insert into avisos_enviados (propietario_id, tipo, referencia_id)
        values (${u.propietarioA}, 'contrato_por_vencer', ${a.contrato})`)
      await expect(
        asUser(u.equipo, (s) => s`insert into avisos_enviados (propietario_id, tipo, referencia_id)
          values (${u.propietarioA}, 'contrato_por_vencer', ${a.contrato})`),
      ).rejects.toThrow(UNIQUE)
      await asUser(u.equipo, (s) => s`insert into avisos_enviados (propietario_id, tipo, referencia_id)
        values (${u.propietarioA}, 'pago_recibido', ${a.contrato})`)
      expect(await asUser(u.equipo, (s) => s`select id from avisos_enviados`)).toHaveLength(2)
      expect(await asUser(u.propA, (s) => s`select * from avisos_enviados`)).toEqual([])
      await expect(
        asUser(u.equipo, (s) => s`delete from avisos_enviados`),
      ).rejects.toThrow(RLS)
    })

    test('existe el usuario sistema (admin)', async () => {
      const rs = await sqlAdmin`select email, nombre, rol from usuarios where id = ${SISTEMA}`
      expect(rs).toEqual([{ email: 'sistema@local', nombre: 'Sistema', rol: 'admin' }])
    })

    test('ref_carga es única en contratos (y existe en las tablas de carga)', async () => {
      const a = await fixture(u.propietarioA)
      const b = await fixture(u.propietarioA)
      await sqlAdmin`update contratos set ref_carga = 'C-1' where id = ${a.contrato}`
      await expect(
        sqlAdmin`update contratos set ref_carga = 'C-1' where id = ${b.contrato}`,
      ).rejects.toThrow(UNIQUE)

      const rs = await sqlAdmin`select c.table_name from information_schema.columns c
        join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public' and c.column_name = 'ref_carga' and t.table_type = 'BASE TABLE'
        order by c.table_name`
      expect(rs.map((r) => r.table_name)).toEqual([
        'cargos', 'contratos', 'inmuebles', 'inquilinos', 'propietarios', 'unidades',
      ])
    })
  })
})
