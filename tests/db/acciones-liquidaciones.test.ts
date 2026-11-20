import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Resultado } from '@/lib/acciones'
import { asUser, closeDb, resetDb, seedUsuarios, sqlAdmin } from './harness'

const frasco = new Map<string, string>()
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: (n: string) => (frasco.has(n) ? { value: frasco.get(n)! } : undefined) }),
}))
process.env.__NEXT_EXPERIMENTAL_AUTH_INTERRUPTS = 'true'

// Almacenamiento real salvo cuando una prueba pide que la subida falle.
const storage = vi.hoisted(() => ({ falla: false }))
vi.mock('@/lib/storage', async (original) => {
  const real = await original<typeof import('@/lib/storage')>()
  return {
    ...real,
    putFile: (...args: Parameters<typeof real.putFile>) =>
      storage.falla ? Promise.reject(new Error('storage caído')) : real.putFile(...args),
  }
})

const { crearCookieLocal } = await import('@/lib/auth/providers/local')
const { closeSql } = await import('@/lib/db')
const { cargarSesion } = await import('@/lib/auth/cargar')
const gas = await import('@/app/app/_actions/gastos')
const liq = await import('@/app/app/_actions/liquidaciones')
const docs = await import('@/app/app/_actions/documentos')
const q = await import('@/lib/queries/liquidaciones')

let ids: Awaited<ReturnType<typeof seedUsuarios>>
let raiz: string
let correos: string
let inmuebleId: string
let unidadId: string
let contratoId: string

const FORBIDDEN = /NEXT_HTTP_ERROR_FALLBACK;403/
const PDF = () => new File(['%PDF-1.4\n%%EOF\n'], 'f.pdf', { type: 'application/pdf' })
const XML = () =>
  new File(['<?xml version="1.0" encoding="UTF-8"?><cfdi:Comprobante/>'], 'f.xml', { type: 'text/xml' })

function como(usuarioId: string) {
  const c = crearCookieLocal(usuarioId)
  frasco.set(c.name, c.value)
}

function okId(r: Resultado): string {
  if (!r.ok) throw new Error(`Se esperaba ok: ${JSON.stringify(r.errores)}`)
  return r.id
}

function fd(datos: Record<string, string | File>) {
  const f = new FormData()
  for (const [k, v] of Object.entries(datos)) f.set(k, v)
  return f
}

function gastoFd(datos: Record<string, string | File> = {}) {
  return fd({
    inmuebleId,
    unidadId: '',
    fecha: '2026-03-10',
    concepto: 'Plomería',
    monto: '1,000',
    pagadoPor: 'disa',
    autorizadoPor: 'Luis',
    ...datos,
  })
}

async function archivosCorreo() {
  try {
    return await readdir(correos)
  } catch {
    return []
  }
}

/** Escenario A (Tarea 4): renta de marzo 10,000 pagada el 3; gasto DISA 1,000 y del propietario 500. */
async function escenarioA() {
  const [c] = await sqlAdmin`insert into cargos (contrato_id, tipo, periodo, monto, fecha_limite)
    values (${contratoId}, 'renta', '2026-03-01', 10000, '2026-03-05') returning id`
  await asUser(ids.equipo, (s) => s`select registrar_pago(${[c.id]}::uuid[], 10000, '2026-03-03',
    'transferencia', 'REF-A-MAR', 'disa', null)`)
  okId(await gas.crearGasto(gastoFd()))
  okId(await gas.crearGasto(gastoFd({ fecha: '2026-03-20', monto: '500', pagadoPor: 'propietario', concepto: 'Pintura' })))
}

async function liquidacion(id: string) {
  const [r] = await sqlAdmin`select estatus, cobrado::float8, comision::float8, iva::float8,
    gastos_disa::float8, gastos_propietario::float8, ajustes::float8, neto::float8, pdf_path,
    pago_fecha::text, pago_referencia, pago_comprobante_path
    from liquidaciones where id = ${id}`
  return r
}

beforeAll(async () => {
  raiz = await mkdtemp(join(tmpdir(), 'rentas-storage-'))
  correos = await mkdtemp(join(tmpdir(), 'rentas-correos-'))
  process.env.STORAGE_LOCAL_ROOT = raiz
  process.env.EMAIL_LOCAL_DIR = correos
  await resetDb()
})
beforeEach(async () => {
  await sqlAdmin`truncate documentos, liquidacion_lineas, ajustes_pendientes, liquidaciones, gastos,
    pago_aplicaciones, pagos, cargos, contratos, unidades, inquilinos, inmuebles,
    propietario_usuarios, propietarios, usuarios cascade`
  await rm(correos, { recursive: true, force: true })
  ids = await seedUsuarios()
  await sqlAdmin`update propietarios set contacto_email = 'dueno@a.mx', avisos_estado_cuenta = true,
    rfc = 'AAA010101AAA' where id = ${ids.propietarioA}`
  const [inm] = await sqlAdmin`insert into inmuebles (propietario_id, nombre, tipo)
    values (${ids.propietarioA}, 'Torre', 'edificio') returning id`
  inmuebleId = inm.id
  const [uni] = await sqlAdmin`insert into unidades (inmueble_id, nombre) values (${inm.id}, 'Depto 101') returning id`
  unidadId = uni.id
  const [inq] = await sqlAdmin`insert into inquilinos (nombre) values ('Juan Pérez') returning id`
  const [c] = await sqlAdmin`insert into contratos (unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago)
    values (${uni.id}, ${inq.id}, '2026-01-01', '2026-12-31', 10000, 5) returning id`
  contratoId = c.id
  como(ids.equipo)
})
afterAll(async () => {
  await closeSql()
  await closeDb()
  await rm(raiz, { recursive: true, force: true })
  await rm(correos, { recursive: true, force: true })
})

describe('gastos', () => {
  it('crearGasto: deriva el propietario, guarda el comprobante y registra quién', async () => {
    const png = new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])], 'c.png', { type: 'image/png' })
    const id = okId(await gas.crearGasto(gastoFd({ unidadId, comprobante: png })))
    const [g] = await sqlAdmin`select propietario_id, unidad_id, monto::float8, pagado_por, autorizado_por,
      registrado_por, comprobante_path from gastos where id = ${id}`
    expect(g).toEqual({
      propietario_id: ids.propietarioA,
      unidad_id: unidadId,
      monto: 1000,
      pagado_por: 'disa',
      autorizado_por: 'Luis',
      registrado_por: ids.equipo,
      comprobante_path: `propietarios/${ids.propietarioA}/gastos/${id}.png`,
    })
    expect((await readFile(join(raiz, g.comprobante_path)))[0]).toBe(0x89)
  })

  it('si la subida del comprobante falla, el gasto queda con advertencia', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    storage.falla = true
    try {
      const r = await gas.crearGasto(gastoFd({ comprobante: PDF() }))
      expect(r).toEqual({ ok: true, id: expect.any(String), advertencia: 'El gasto se registró pero no se pudo guardar el comprobante' })
      const [g] = await sqlAdmin`select comprobante_path from gastos where id = ${okId(r)}`
      expect(g.comprobante_path).toBeNull()
    } finally {
      storage.falla = false
      error.mockRestore()
    }
  })

  it('validaciones y errores en español; eliminar sólo admin; gasto liquidado inmutable', async () => {
    expect(await gas.crearGasto(gastoFd({ monto: '0' }))).toMatchObject({ ok: false, errores: { monto: expect.any(String) } })
    expect(await gas.crearGasto(gastoFd({ pagadoPor: 'x' }))).toMatchObject({ ok: false, errores: { pagadoPor: expect.any(String) } })
    const [otro] = await sqlAdmin`insert into inmuebles (propietario_id, nombre, tipo)
      values (${ids.propietarioB}, 'Otro', 'edificio') returning id`
    expect(await gas.crearGasto(gastoFd({ inmuebleId: otro.id, unidadId }))).toEqual({
      ok: false,
      errores: { unidadId: 'La unidad no pertenece a ese inmueble' },
    })

    const id = okId(await gas.crearGasto(gastoFd()))
    okId(await gas.actualizarGasto(id, gastoFd({ concepto: 'Plomería baño', monto: '1,200' })))
    const [g] = await sqlAdmin`select concepto, monto::float8 from gastos where id = ${id}`
    expect(g).toEqual({ concepto: 'Plomería baño', monto: 1200 })

    await expect(gas.eliminarGasto(id)).rejects.toThrow(FORBIDDEN)

    const lid = okId(await liq.prepararLiquidacion(ids.propietarioA, '2026-03'))
    como(ids.admin)
    okId(await liq.cerrarLiquidacion(lid))
    expect(await gas.actualizarGasto(id, gastoFd({ monto: '5' }))).toEqual({
      ok: false,
      errores: { _form: 'El gasto ya forma parte de una liquidación cerrada' },
    })
    expect(await gas.eliminarGasto(id)).toEqual({ ok: false, errores: { _form: 'El gasto ya forma parte de una liquidación cerrada' } })

    const libre = okId(await gas.crearGasto(gastoFd({ fecha: '2026-04-02' })))
    expect(await gas.eliminarGasto(libre)).toEqual({ ok: true, id: libre })
  })

  it('gastosLista filtra por propietario, inmueble y periodo', async () => {
    const a = okId(await gas.crearGasto(gastoFd()))
    okId(await gas.crearGasto(gastoFd({ fecha: '2026-04-02' })))
    const sesion = (await cargarSesion(ids.equipo))!
    expect((await q.gastosLista(sesion, { periodo: '2026-03' })).map((g) => g.id)).toEqual([a])
    expect(await q.gastosLista(sesion, { propietarioId: ids.propietarioB })).toEqual([])
    const filas = await q.gastosLista(sesion, { inmuebleId })
    expect(filas).toHaveLength(2)
    expect(filas[0]).toMatchObject({ inmueble_nombre: 'Torre', propietario_nombre: 'A' })
  })
})

describe('liquidaciones', () => {
  it('equipo prepara: totales del escenario A', async () => {
    await escenarioA()
    const id = okId(await liq.prepararLiquidacion(ids.propietarioA, '2026-03'))
    expect(await liquidacion(id)).toMatchObject({
      estatus: 'borrador', cobrado: 10000, comision: 1500, iva: 240, gastos_disa: 1000, gastos_propietario: 500, neto: 7260,
    })
    expect(await liq.prepararLiquidacion(ids.propietarioA, 'marzo')).toMatchObject({ ok: false })

    const sesion = (await cargarSesion(ids.equipo))!
    const resumen = await q.liquidacionesResumen(sesion, { periodo: '2026-03' })
    expect(resumen.map((r) => [r.propietario_nombre, r.liquidacion_id, r.estatus])).toEqual([
      ['A', id, 'borrador'],
      ['B', null, null],
    ])
    const d = await q.liquidacionDetalle(sesion, id)
    expect(d?.lineas.map((l) => l.tipo)).toEqual(['cobro', 'gasto_disa', 'gasto_propietario'])
    expect(d?.propietario).toMatchObject({ nombre: 'A', rfc: 'AAA010101AAA' })
  })

  it('equipo no cierra; admin cierra: PDF, documento reporte y aviso por correo', async () => {
    await escenarioA()
    const id = okId(await liq.prepararLiquidacion(ids.propietarioA, '2026-03'))
    expect(await liq.cerrarLiquidacion(id)).toEqual({
      ok: false,
      errores: { _form: 'Sólo el administrador puede cerrar liquidaciones' },
    })
    expect((await liquidacion(id)).estatus).toBe('borrador')

    como(ids.admin)
    expect(await liq.cerrarLiquidacion(id)).toEqual({ ok: true, id })
    const l = await liquidacion(id)
    const ruta = `propietarios/${ids.propietarioA}/liquidaciones/2026-03.pdf`
    expect(l).toMatchObject({ estatus: 'cerrada', pdf_path: ruta, neto: 7260 })
    expect((await readFile(join(raiz, ruta))).subarray(0, 4).toString()).toBe('%PDF')
    const docsRep = await sqlAdmin`select tipo, nombre, path, liquidacion_id, subido_por from documentos`
    expect(docsRep).toEqual([
      { tipo: 'reporte', nombre: 'Estado de cuenta 2026-03', path: ruta, liquidacion_id: id, subido_por: ids.admin },
    ])
    const [archivo] = await archivosCorreo()
    const correo = JSON.parse(await readFile(join(correos, archivo), 'utf8'))
    expect(correo.to).toBe('dueno@a.mx')
    expect(correo.subject).toBe('Tu estado de cuenta de marzo de 2026 está listo')
    expect(correo.subject).toContain('estado de cuenta')

    expect(await liq.cerrarLiquidacion(id)).toEqual({
      ok: false,
      errores: { _form: 'La liquidación no está en el estado correcto para esta acción' },
    })
    expect(await liq.prepararLiquidacion(ids.propietarioA, '2026-03')).toEqual({
      ok: false,
      errores: { _form: 'La liquidación ya está cerrada' },
    })

    // Regenerar no duplica el documento.
    como(ids.equipo)
    expect(await liq.regenerarPdfLiquidacion(id)).toEqual({ ok: true, id })
    const [{ n }] = await sqlAdmin`select count(*)::int as n from documentos`
    expect(n).toBe(1)
  })

  it('si el PDF falla al cerrar, la liquidación queda cerrada con advertencia; regenerar lo arregla', async () => {
    await sqlAdmin`update propietarios set avisos_estado_cuenta = false where id = ${ids.propietarioA}`
    await escenarioA()
    const id = okId(await liq.prepararLiquidacion(ids.propietarioA, '2026-03'))
    como(ids.admin)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    storage.falla = true
    try {
      expect(await liq.cerrarLiquidacion(id)).toEqual({
        ok: true,
        id,
        advertencia: 'La liquidación se cerró pero no se pudo generar el PDF; usa "Regenerar PDF"',
      })
    } finally {
      storage.falla = false
      error.mockRestore()
    }
    expect(await liquidacion(id)).toMatchObject({ estatus: 'cerrada', pdf_path: null })
    expect(await archivosCorreo()).toEqual([])
    okId(await liq.regenerarPdfLiquidacion(id))
    expect((await liquidacion(id)).pdf_path).toBe(`propietarios/${ids.propietarioA}/liquidaciones/2026-03.pdf`)
  })

  it('pagar: sólo desde cerrada; comprobante a la ruta del periodo', async () => {
    await escenarioA()
    const id = okId(await liq.prepararLiquidacion(ids.propietarioA, '2026-03'))
    const pago = () => fd({ fecha: '2026-04-05', referencia: 'TRF-9', comprobante: PDF() })
    expect(await liq.pagarLiquidacion(id, pago())).toEqual({
      ok: false,
      errores: { _form: 'La liquidación no está en el estado correcto para esta acción' },
    })
    como(ids.admin)
    okId(await liq.cerrarLiquidacion(id))
    como(ids.equipo)

    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    storage.falla = true
    try {
      expect(await liq.pagarLiquidacion(id, pago())).toEqual({
        ok: false,
        errores: { comprobante: 'No se pudo guardar el comprobante. Intenta de nuevo.' },
      })
    } finally {
      storage.falla = false
      err.mockRestore()
    }
    expect((await liquidacion(id)).estatus).toBe('cerrada')

    expect(await liq.pagarLiquidacion(id, pago())).toEqual({ ok: true, id })
    const ruta = `propietarios/${ids.propietarioA}/liquidaciones/2026-03-pago.pdf`
    expect(await liquidacion(id)).toMatchObject({
      estatus: 'pagada', pago_fecha: '2026-04-05', pago_referencia: 'TRF-9', pago_comprobante_path: ruta,
    })
    expect((await readFile(join(raiz, ruta))).subarray(0, 4).toString()).toBe('%PDF')
  })

  it('registrarAjuste: sólo admin; entra en la siguiente liquidación', async () => {
    await expect(liq.registrarAjuste(ids.propietarioA, '100', 'Corrección')).rejects.toThrow(FORBIDDEN)
    como(ids.admin)
    expect(await liq.registrarAjuste(ids.propietarioA, '0', 'x')).toMatchObject({ ok: false, errores: { monto: expect.any(String) } })
    expect(await liq.registrarAjuste(ids.propietarioA, '100', ' ')).toMatchObject({ ok: false, errores: { descripcion: expect.any(String) } })
    okId(await liq.registrarAjuste(ids.propietarioA, '-250.50', 'Corrección de febrero'))
    const id = okId(await liq.prepararLiquidacion(ids.propietarioA, '2026-03'))
    expect(await liquidacion(id)).toMatchObject({ ajustes: -250.5, neto: -250.5 })
  })
})

describe('documentos', () => {
  it('factura PDF + XML → dos documentos con el mismo nombre; otros tipos un archivo', async () => {
    const r = await docs.subirDocumento(
      ids.propietarioA,
      fd({ tipo: 'factura', nombre: 'Factura comisión marzo', archivo: PDF(), xml: XML(), unidadId, visiblePropietario: 'on' }),
    )
    okId(r)
    const filas = await sqlAdmin`select id, tipo, nombre, path, unidad_id, visible_propietario, subido_por
      from documentos order by path`
    expect(filas).toHaveLength(2)
    expect(new Set(filas.map((f) => f.nombre))).toEqual(new Set(['Factura comisión marzo']))
    expect(filas.map((f) => f.path.split('.').pop()).sort()).toEqual(['pdf', 'xml'])
    for (const f of filas) {
      expect(f).toMatchObject({ tipo: 'factura', unidad_id: unidadId, visible_propietario: true, subido_por: ids.equipo })
      expect(f.path).toBe(`propietarios/${ids.propietarioA}/documentos/${f.id}.${f.path.split('.').pop()}`)
      await readFile(join(raiz, f.path))
    }

    okId(await docs.subirDocumento(ids.propietarioA, fd({ tipo: 'contrato', nombre: 'Anexo', archivo: PDF() })))
    const [anexo] = await sqlAdmin`select visible_propietario from documentos where nombre = 'Anexo'`
    expect(anexo.visible_propietario).toBe(false)

    const sesion = (await cargarSesion(ids.equipo))!
    expect(await q.documentosDePropietario(sesion, ids.propietarioA)).toHaveLength(3)
  })

  it('validaciones: XML inválido, sin archivo, liga de otro propietario', async () => {
    expect(await docs.subirDocumento(ids.propietarioA, fd({ tipo: 'factura', nombre: 'F', archivo: PDF(), xml: PDF() }))).toEqual({
      ok: false,
      errores: { xml: 'El archivo no es un XML' },
    })
    expect(await docs.subirDocumento(ids.propietarioA, fd({ tipo: 'otro', nombre: 'F' }))).toEqual({
      ok: false,
      errores: { archivo: 'Sube el archivo' },
    })
    const [iB] = await sqlAdmin`insert into inmuebles (propietario_id, nombre, tipo)
      values (${ids.propietarioB}, 'Otro', 'edificio') returning id`
    const [uB] = await sqlAdmin`insert into unidades (inmueble_id, nombre) values (${iB.id}, 'B-1') returning id`
    expect(await docs.subirDocumento(ids.propietarioA, fd({ tipo: 'otro', nombre: 'F', archivo: PDF(), unidadId: uB.id }))).toEqual({
      ok: false,
      errores: { _form: 'El documento hace referencia a datos de otro propietario' },
    })
    const [{ n }] = await sqlAdmin`select count(*)::int as n from documentos`
    expect(n).toBe(0)
  })

  it('actualizar metadatos (equipo) y eliminar (sólo admin)', async () => {
    okId(await docs.subirDocumento(ids.propietarioA, fd({ tipo: 'otro', nombre: 'Foto', archivo: PDF(), visiblePropietario: 'on' })))
    const [d] = await sqlAdmin`select id from documentos`
    okId(await docs.actualizarDocumento(d.id, { nombre: 'Foto fachada', tipo: 'reporte', visiblePropietario: false }))
    const [e] = await sqlAdmin`select nombre, tipo, visible_propietario from documentos where id = ${d.id}`
    expect(e).toEqual({ nombre: 'Foto fachada', tipo: 'reporte', visible_propietario: false })
    await expect(docs.eliminarDocumento(d.id)).rejects.toThrow(FORBIDDEN)
    como(ids.admin)
    expect(await docs.eliminarDocumento(d.id)).toEqual({ ok: true, id: d.id })
  })
})

describe('propietario rechazado en todas las acciones', () => {
  it('403', async () => {
    const id = '00000000-0000-0000-0000-000000000999'
    como(ids.propA)
    await expect(gas.crearGasto(gastoFd())).rejects.toThrow(FORBIDDEN)
    await expect(gas.actualizarGasto(id, gastoFd())).rejects.toThrow(FORBIDDEN)
    await expect(gas.eliminarGasto(id)).rejects.toThrow(FORBIDDEN)
    await expect(liq.prepararLiquidacion(ids.propietarioA, '2026-03')).rejects.toThrow(FORBIDDEN)
    await expect(liq.cerrarLiquidacion(id)).rejects.toThrow(FORBIDDEN)
    await expect(liq.regenerarPdfLiquidacion(id)).rejects.toThrow(FORBIDDEN)
    await expect(liq.pagarLiquidacion(id, fd({ fecha: '2026-04-01', referencia: 'x' }))).rejects.toThrow(FORBIDDEN)
    await expect(liq.registrarAjuste(ids.propietarioA, '1', 'x')).rejects.toThrow(FORBIDDEN)
    await expect(docs.subirDocumento(ids.propietarioA, fd({ tipo: 'otro', nombre: 'x', archivo: PDF() }))).rejects.toThrow(FORBIDDEN)
    await expect(docs.actualizarDocumento(id, { nombre: 'x', tipo: 'otro', visiblePropietario: true })).rejects.toThrow(FORBIDDEN)
    await expect(docs.eliminarDocumento(id)).rejects.toThrow(FORBIDDEN)
    const [{ n }] = await sqlAdmin`select (select count(*) from gastos) + (select count(*) from liquidaciones)
      + (select count(*) from documentos) as n`
    expect(Number(n)).toBe(0)
  })
})
