import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { asUser, closeDb, resetDb, seedUsuarios, sqlAdmin } from './harness'

const RLS = /row-level security|permission denied/
const CHECK = /violates check constraint/

describe('esquema base y RLS (0001_core)', () => {
  let u: Awaited<ReturnType<typeof seedUsuarios>>

  beforeAll(async () => {
    await resetDb()
  })
  beforeEach(async () => {
    await sqlAdmin`truncate contratos, unidades, inquilinos, inmuebles cascade`
    u = await seedUsuarios()
  })
  afterAll(async () => {
    await closeDb()
  })

  test('propietario A no ve inmuebles de B', async () => {
    await asUser(u.admin, async (s) => {
      await s`insert into inmuebles (propietario_id, nombre, direccion, tipo) values
        (${u.propietarioA}, 'Edificio A', 'Calle A 1', 'edificio'),
        (${u.propietarioB}, 'Casa B', 'Calle B 2', 'casa')`
    })
    const filas = await asUser(u.propA, (s) => s`select * from inmuebles`)
    expect(filas).toHaveLength(1)
    expect(filas[0].propietario_id).toBe(u.propietarioA)

    const props = await asUser(u.propA, (s) => s`select id from propietarios`)
    expect(props.map((p) => p.id)).toEqual([u.propietarioA])
  })

  test('equipo ve todos los propietarios pero no puede cambiar comision_pct', async () => {
    const filas = await asUser(u.equipo, (s) => s`select * from propietarios`)
    expect(filas).toHaveLength(2)

    await expect(
      asUser(u.equipo, (s) => s`update propietarios set comision_pct = 10`),
    ).rejects.toThrow(RLS)

    const [a] = await sqlAdmin`select comision_pct from propietarios where id = ${u.propietarioA}`
    expect(Number(a.comision_pct)).toBe(15)
  })

  test('equipo crea inmueble, unidad, inquilino y contrato', async () => {
    const contrato = await asUser(u.equipo, async (s) => {
      const [inm] = await s`insert into inmuebles (propietario_id, nombre, direccion, tipo)
        values (${u.propietarioA}, 'Torre', 'Av. 1', 'edificio') returning id`
      const [uni] = await s`insert into unidades (inmueble_id, nombre)
        values (${inm.id}, 'Depto 101') returning id, propietario_id`
      expect(uni.propietario_id).toBe(u.propietarioA)
      const [inq] = await s`insert into inquilinos (nombre, email, telefono, rfc)
        values ('Juan Pérez', 'juan@x.mx', '5555555555', 'PEJJ800101AAA') returning id`
      const [c] = await s`insert into contratos
        (unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago)
        values (${uni.id}, ${inq.id}, '2026-01-01', '2026-12-31', 15000, 5)
        returning id, propietario_id, estatus, deposito`
      return { c, uni: uni.id, inq: inq.id }
    })
    expect(contrato.c.propietario_id).toBe(u.propietarioA)
    expect(contrato.c.estatus).toBe('vigente')

    await expect(
      asUser(u.equipo, (s) => s`insert into contratos
        (unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago)
        values (${contrato.uni}, ${contrato.inq}, '2026-01-01', '2026-12-31', 15000, 31)`),
    ).rejects.toThrow(CHECK)
  })

  test('propietario no lee inquilinos', async () => {
    await sqlAdmin`insert into inquilinos (nombre) values ('Alguien')`
    const filas = await asUser(u.propA, (s) => s`select * from inquilinos`)
    expect(filas).toEqual([])
  })

  test('propietario sólo lee su propio renglón de usuarios', async () => {
    const filas = await asUser(u.propA, (s) => s`select id from usuarios`)
    expect(filas.map((f) => f.id)).toEqual([u.propA])
  })

  test('el propietario_id de unidades y contratos sigue al inmueble', async () => {
    const [inm] = await sqlAdmin`insert into inmuebles (propietario_id, nombre, direccion, tipo)
      values (${u.propietarioA}, 'Local', 'Av. 2', 'local') returning id`
    const [uni] = await sqlAdmin`insert into unidades (inmueble_id, nombre)
      values (${inm.id}, 'L1') returning id`
    const [inq] = await sqlAdmin`insert into inquilinos (nombre) values ('Inq') returning id`
    await sqlAdmin`insert into contratos (unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago)
      values (${uni.id}, ${inq.id}, '2026-01-01', '2026-12-31', 1000, 1)`

    await asUser(u.admin, (s) => s`update inmuebles set propietario_id = ${u.propietarioB} where id = ${inm.id}`)

    const [un] = await sqlAdmin`select propietario_id from unidades where id = ${uni.id}`
    const [co] = await sqlAdmin`select propietario_id from contratos where unidad_id = ${uni.id}`
    expect(un.propietario_id).toBe(u.propietarioB)
    expect(co.propietario_id).toBe(u.propietarioB)
  })

  test('el propietario_id enviado por el cliente se ignora (unidades y contratos)', async () => {
    const [inm] = await sqlAdmin`insert into inmuebles (propietario_id, nombre, direccion, tipo)
      values (${u.propietarioA}, 'Torre A', 'Av. 3', 'edificio') returning id`

    const uni = await asUser(u.equipo, async (s) => {
      const [r] = await s`insert into unidades (inmueble_id, propietario_id, nombre)
        values (${inm.id}, ${u.propietarioB}, 'U1') returning id`
      return r
    })
    const [un] = await sqlAdmin`select propietario_id from unidades where id = ${uni.id}`
    expect(un.propietario_id).toBe(u.propietarioA)

    const [inq] = await sqlAdmin`insert into inquilinos (nombre) values ('Inq') returning id`
    const [c] = await sqlAdmin`insert into contratos (unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago)
      values (${uni.id}, ${inq.id}, '2026-01-01', '2026-12-31', 1000, 1) returning id`
    await asUser(u.equipo, (s) => s`update contratos set propietario_id = ${u.propietarioB} where id = ${c.id}`)
    const [co] = await sqlAdmin`select propietario_id from contratos where id = ${c.id}`
    expect(co.propietario_id).toBe(u.propietarioA)
  })

  test('contratos exige fecha_fin y fecha_fin >= fecha_inicio', async () => {
    const [inm] = await sqlAdmin`insert into inmuebles (propietario_id, nombre, direccion, tipo)
      values (${u.propietarioA}, 'Casa', 'Av. 4', 'casa') returning id`
    const [uni] = await sqlAdmin`insert into unidades (inmueble_id, nombre) values (${inm.id}, 'C1') returning id`
    const [inq] = await sqlAdmin`insert into inquilinos (nombre) values ('Inq') returning id`
    await expect(
      asUser(u.equipo, (s) => s`insert into contratos (unidad_id, inquilino_id, fecha_inicio, renta_mensual, dia_pago)
        values (${uni.id}, ${inq.id}, '2026-01-01', 1000, 1)`),
    ).rejects.toThrow(/null value in column "fecha_fin"/)
    await expect(
      asUser(u.equipo, (s) => s`insert into contratos (unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago)
        values (${uni.id}, ${inq.id}, '2026-06-01', '2026-05-31', 1000, 1)`),
    ).rejects.toThrow(CHECK)
  })

  test('a lo más un contrato vigente por unidad (índice único parcial, 0006)', async () => {
    const [inm] = await sqlAdmin`insert into inmuebles (propietario_id, nombre, direccion, tipo)
      values (${u.propietarioA}, 'Casa', 'Av. 5', 'casa') returning id`
    const [uni] = await sqlAdmin`insert into unidades (inmueble_id, nombre) values (${inm.id}, 'U1') returning id`
    const [inq] = await sqlAdmin`insert into inquilinos (nombre) values ('Inq') returning id`
    const alta = (estatus: string) => sqlAdmin`
      insert into contratos (unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago, estatus)
      values (${uni.id}, ${inq.id}, '2026-01-01', '2026-12-31', 1000, 1, ${estatus})`
    await alta('vigente')
    await alta('pendiente_firma')
    await alta('terminado')
    await expect(alta('vigente')).rejects.toThrow(/contratos_una_vigente_por_unidad/)
  })

  test('app.rol_actual()', async () => {
    const [a] = await asUser(u.admin, (s) => s`select app.rol_actual() as rol`)
    const [p] = await asUser(u.propA, (s) => s`select app.rol_actual() as rol`)
    expect(a.rol).toBe('admin')
    expect(p.rol).toBe('propietario')
  })
})
