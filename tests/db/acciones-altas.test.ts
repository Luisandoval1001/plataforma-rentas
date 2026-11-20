import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Resultado } from '@/lib/acciones'
import { asUser, closeDb, resetDb, seedUsuarios, sqlAdmin } from './harness'

// Las acciones leen la sesión de la cookie local: se simula next/headers con un frasco mutable.
const frasco = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (frasco.has(n) ? { value: frasco.get(n)! } : undefined) }),
}))

// next build/dev define esta variable a partir de experimental.authInterrupts.
process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = 'true'

const { crearCookieLocal } = await import('@/lib/auth/providers/local')
const { closeSql } = await import('@/lib/db')
const props = await import('@/app/app/_actions/propietarios')
const inm = await import('@/app/app/_actions/inmuebles')
const uni = await import('@/app/app/_actions/unidades')
const inq = await import('@/app/app/_actions/inquilinos')
const con = await import('@/app/app/_actions/contratos')
const { obtenerContrato } = await import('@/lib/queries/contratos')

let ids: Awaited<ReturnType<typeof seedUsuarios>>
let raiz: string

function como(usuarioId: string) {
  const c = crearCookieLocal(usuarioId)
  frasco.set(c.name, c.value)
}

function fd(datos: Record<string, string | File>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(datos)) f.set(k, v)
  return f
}

const PDF = () => new File(['%PDF-1.4\n%%EOF\n'], 'c.pdf', { type: 'application/pdf' })
const FORBIDDEN = /NEXT_HTTP_ERROR_FALLBACK;403/

function okId(r: Resultado): string {
  if (!r.ok) throw new Error(`Se esperaba ok: ${JSON.stringify(r.errores)}`)
  return r.id
}

async function unidadNueva(nombre = '101') {
  const inmuebleId = okId(await inm.crearInmueble(fd({ nombre: `Torre ${nombre}`, tipo: 'edificio', propietario_id: ids.propietarioA })))
  return okId(await uni.crearUnidad(inmuebleId, fd({ nombre })))
}

async function contratoVigente(unidadId: string, extra: Record<string, string | File> = {}) {
  return okId(
    await con.crearContrato(
      fd({
        unidad_id: unidadId,
        inquilino_nombre: 'Juan Pérez',
        fecha_inicio: '2026-03-01',
        fecha_fin: '2027-02-28',
        renta_mensual: '18,000',
        dia_pago: '5',
        incremento_anual_pct: '4.5',
        deposito: '18000',
        ...extra,
      }),
    ),
  )
}

beforeAll(async () => {
  raiz = await mkdtemp(join(tmpdir(), 'rentas-storage-'))
  process.env.STORAGE_LOCAL_ROOT = raiz
  await resetDb()
})
beforeEach(async () => {
  await sqlAdmin`truncate contratos, unidades, inquilinos, inmuebles, propietario_usuarios, propietarios, usuarios cascade`
  ids = await seedUsuarios()
  como(ids.equipo)
})
afterAll(async () => {
  await closeSql()
  await closeDb()
  await rm(raiz, { recursive: true, force: true })
})

describe('acciones de propietarios (sólo admin)', () => {
  const datos = { nombre: 'Villalongin', modelo: 'cobra_disa', comision_pct: '15' }

  it('equipo es rechazado por la acción misma (403) y no se escribe nada', async () => {
    await expect(props.crearPropietario(fd(datos))).rejects.toThrow(FORBIDDEN)
    await expect(props.actualizarPropietario(ids.propietarioA, fd({ ...datos, comision_pct: '1' }))).rejects.toThrow(FORBIDDEN)
    await expect(props.invitarUsuarioPropietario(ids.propietarioA, fd({ nombre: 'X', email: 'x@x.mx' }))).rejects.toThrow(FORBIDDEN)
    const [a] = await sqlAdmin`select comision_pct from propietarios where id = ${ids.propietarioA}`
    expect(Number(a.comision_pct)).toBe(15)
    const [{ n }] = await sqlAdmin`select count(*)::int as n from propietarios`
    expect(n).toBe(2)
  })

  it('admin crea, actualiza y devuelve errores de validación por campo', async () => {
    como(ids.admin)
    const id = okId(await props.crearPropietario(fd(datos)))
    expect(await props.actualizarPropietario(id, fd({ ...datos, comision_pct: '101' }))).toEqual({
      ok: false,
      errores: { comision_pct: 'Entre 0 y 100' },
    })
    okId(await props.actualizarPropietario(id, fd({ ...datos, comision_pct: '12', avisos_pago: 'on' })))
    const [p] = await sqlAdmin`select comision_pct, avisos_pago, avisos_contrato from propietarios where id = ${id}`
    expect(p).toMatchObject({ comision_pct: '12.00', avisos_pago: true, avisos_contrato: false })
  })

  it('invitar (local) crea usuario propietario y lo liga; re-invitar sólo liga; correo del equipo → error', async () => {
    como(ids.admin)
    const usuarioId = okId(await props.invitarUsuarioPropietario(ids.propietarioA, fd({ nombre: 'Ana', email: 'Ana@X.mx' })))
    const [u] = await sqlAdmin`select email, rol from usuarios where id = ${usuarioId}`
    expect(u).toEqual({ email: 'ana@x.mx', rol: 'propietario' })
    expect(okId(await props.invitarUsuarioPropietario(ids.propietarioB, fd({ nombre: 'Ana', email: 'ana@x.mx' })))).toBe(usuarioId)
    const ligas = await sqlAdmin`select propietario_id from propietario_usuarios where usuario_id = ${usuarioId} order by propietario_id`
    expect(ligas.map((l) => l.propietario_id)).toEqual([ids.propietarioA, ids.propietarioB])

    await sqlAdmin`insert into usuarios (email, nombre, rol) values ('cobro@disa.mx', 'Cobro', 'equipo')`
    expect(await props.invitarUsuarioPropietario(ids.propietarioA, fd({ nombre: 'E', email: 'cobro@disa.mx' }))).toEqual({
      ok: false,
      errores: { email: 'Ese correo pertenece a un usuario del equipo' },
    })
  })
})

describe('acciones de inmuebles, unidades e inquilinos (equipo)', () => {
  it('equipo crea inmueble con cobrador, unidad e inquilino; cobrador propietario → error', async () => {
    const inmuebleId = okId(
      await inm.crearInmueble(fd({ nombre: 'Orizaba 36', tipo: 'edificio', propietario_id: ids.propietarioA, cobrador_id: ids.equipo })),
    )
    expect(
      await inm.actualizarInmueble(inmuebleId, fd({ nombre: 'Orizaba 36', tipo: 'edificio', cobrador_id: ids.propA })),
    ).toEqual({ ok: false, errores: { cobrador_id: 'El cobrador debe ser un usuario activo del equipo' } })
    const unidadId = okId(await uni.crearUnidad(inmuebleId, fd({ nombre: '407' })))
    const [u] = await sqlAdmin`select propietario_id from unidades where id = ${unidadId}`
    expect(u.propietario_id).toBe(ids.propietarioA)
    okId(await inq.crearInquilino(fd({ nombre: 'Juan', rfc: 'pejj800101aaa' })))
    const [i] = await sqlAdmin`select rfc from inquilinos`
    expect(i.rfc).toBe('PEJJ800101AAA')
  })

  it('un propietario no pasa requireRol', async () => {
    como(ids.propA)
    await expect(inm.crearInmueble(fd({ nombre: 'X', tipo: 'casa', propietario_id: ids.propietarioA }))).rejects.toThrow(FORBIDDEN)
  })
})

describe('acciones de contratos', () => {
  it('crearContrato con inquilino nuevo y PDF guarda el archivo en propietarios/<pid>/contratos/<id>.pdf', async () => {
    const unidadId = await unidadNueva()
    const id = await contratoVigente(unidadId, { pdf: PDF() })
    const [c] = await sqlAdmin`
      select c.estatus, c.pdf_path, c.renta_mensual, i.nombre from contratos c join inquilinos i on i.id = c.inquilino_id
      where c.id = ${id}`
    expect(c).toMatchObject({ estatus: 'vigente', renta_mensual: '18000.00', nombre: 'Juan Pérez' })
    expect(c.pdf_path).toBe(`propietarios/${ids.propietarioA}/contratos/${id}.pdf`)
    expect((await readFile(join(raiz, c.pdf_path))).toString()).toMatch(/^%PDF-/)
  })

  it('un segundo contrato vigente en la misma unidad se rechaza y no deja inquilino huérfano', async () => {
    const unidadId = await unidadNueva()
    await contratoVigente(unidadId)
    expect(await con.crearContrato(fd({
      unidad_id: unidadId, inquilino_nombre: 'Otra', fecha_inicio: '2026-03-01', fecha_fin: '2027-02-28',
      renta_mensual: '1', dia_pago: '1',
    }))).toEqual({ ok: false, errores: { unidad_id: 'La unidad ya tiene un contrato vigente' } })
    const [{ n }] = await sqlAdmin`select count(*)::int as n from inquilinos`
    expect(n).toBe(1)
  })

  it('renovar: pendiente de firma hoy, fechas +1 año, renta con incremento redondeada; no se renueva dos veces', async () => {
    const origen = await contratoVigente(await unidadNueva())
    const id = okId(await con.renovarContrato(origen))
    const [n] = await sqlAdmin`
      select estatus, pendiente_firma_desde = current_date as hoy, fecha_inicio::text, fecha_fin::text,
             renta_mensual, dia_pago, deposito, incremento_anual_pct, contrato_origen_id
      from contratos where id = ${id}`
    expect(n).toEqual({
      estatus: 'pendiente_firma', hoy: true, fecha_inicio: '2027-03-01', fecha_fin: '2028-02-29',
      renta_mensual: '18810.00', dia_pago: 5, deposito: '18000.00', incremento_anual_pct: '4.50', contrato_origen_id: origen,
    })
    expect(await con.renovarContrato(origen)).toEqual({ ok: false, errores: { _form: 'Este contrato ya tiene una renovación' } })
    expect(await con.renovarContrato(id)).toEqual({ ok: false, errores: { _form: 'Sólo se renueva un contrato vigente' } })
  })

  it('renovar un contrato de varios años parte de la renta vigente al final (incremento compuesto)', async () => {
    const origen = await contratoVigente(await unidadNueva(), {
      fecha_inicio: '2024-03-01', fecha_fin: '2027-02-28', renta_mensual: '10000', incremento_anual_pct: '5',
    })
    const id = okId(await con.renovarContrato(origen))
    const [n] = await sqlAdmin`select renta_mensual from contratos where id = ${id}`
    expect(n.renta_mensual).toBe('11576.25') // 10000 × 1.05³
  })

  it('activar exige PDF; deja vigente la renovación y termina el origen; terminar sólo vigentes', async () => {
    const origen = await contratoVigente(await unidadNueva())
    const id = okId(await con.renovarContrato(origen))
    expect(await con.activarContrato(id, fd({}))).toEqual({ ok: false, errores: { pdf: 'Sube el PDF' } })
    okId(await con.activarContrato(id, fd({ pdf: PDF() })))
    const filas = await sqlAdmin`select id, estatus, pdf_path from contratos order by created_at`
    expect(filas.map((f) => f.estatus)).toEqual(['terminado', 'vigente'])
    expect(filas[1].pdf_path).toBe(`propietarios/${ids.propietarioA}/contratos/${id}.pdf`)

    expect(await con.activarContrato(id, fd({ pdf: PDF() }))).toEqual({
      ok: false, errores: { _form: 'El contrato no está pendiente de firma' },
    })
    expect(await con.terminarContrato(origen)).toEqual({ ok: false, errores: { _form: 'Sólo se termina un contrato vigente' } })
    okId(await con.terminarContrato(id))
    const [t] = await sqlAdmin`select estatus from contratos where id = ${id}`
    expect(t.estatus).toBe('terminado')
  })

  it('una renovación terminada no cuenta: la ficha vuelve a ofrecer Renovar y la acción lo permite', async () => {
    const origen = await contratoVigente(await unidadNueva())
    const primera = okId(await con.renovarContrato(origen))
    const ficha = () => asUser(ids.equipo, (sql) => obtenerContrato(sql, origen))
    expect((await ficha())?.renovacion_id).toBe(primera)
    await sqlAdmin`update contratos set estatus = 'terminado' where id = ${primera}`
    expect((await ficha())?.renovacion_id).toBeNull()
    const segunda = okId(await con.renovarContrato(origen))
    expect((await ficha())?.renovacion_id).toBe(segunda)
  })

  it('activar una renovación falla si la unidad tiene otro contrato vigente distinto del origen', async () => {
    const unidadId = await unidadNueva()
    const origen = await contratoVigente(unidadId)
    const id = okId(await con.renovarContrato(origen))
    // El origen se termina a mano y entra otro contrato vigente en la unidad.
    okId(await con.terminarContrato(origen))
    await contratoVigente(unidadId, { inquilino_nombre: 'Otro' })
    expect(await con.activarContrato(id, fd({ pdf: PDF() }))).toEqual({
      ok: false, errores: { unidad_id: 'La unidad ya tiene un contrato vigente' },
    })
  })

  it('ids inválidos se rechazan sin tocar la BD', async () => {
    expect(await con.renovarContrato('x')).toEqual({ ok: false, errores: { _form: 'Contrato inválido' } })
    expect(await con.terminarContrato("'; drop table contratos; --")).toEqual({ ok: false, errores: { _form: 'Contrato inválido' } })
  })
})
