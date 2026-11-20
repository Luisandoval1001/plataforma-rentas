import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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
const cob = await import('@/app/app/_actions/cobranza')
const { cargosDelMes } = await import('@/lib/queries/cobranza')
const { tablero } = await import('@/lib/queries/tablero')
const { cargarSesion } = await import('@/lib/auth/cargar')

let ids: Awaited<ReturnType<typeof seedUsuarios>>
let raiz: string
let correos: string
let contratoId: string
let inmuebleId: string
let hoy: string

const FORBIDDEN = /NEXT_HTTP_ERROR_FALLBACK;403/

function como(usuarioId: string) {
  const c = crearCookieLocal(usuarioId)
  frasco.set(c.name, c.value)
}

function okId(r: Resultado): string {
  if (!r.ok) throw new Error(`Se esperaba ok: ${JSON.stringify(r.errores)}`)
  return r.id
}

function pagoFd(cargoIds: string[], datos: Record<string, string | File> = {}) {
  const f = new FormData()
  for (const c of cargoIds) f.append('cargoIds', c)
  const base = { monto: '4,000', fecha: hoy, metodo: 'transferencia', referencia: '', cuenta: 'disa', ...datos }
  for (const [k, v] of Object.entries(base)) f.set(k, v)
  return f
}

async function cargo(monto: number, diasDesdeHoy: number, mesesAtras = 0): Promise<string> {
  const [c] = await sqlAdmin`insert into cargos (contrato_id, tipo, periodo, monto, fecha_limite)
    values (${contratoId}, 'renta', (date_trunc('month', current_date) - ${mesesAtras} * interval '1 month')::date,
            ${monto}, current_date + ${diasDesdeHoy}::int)
    returning id`
  return c.id
}

async function estatus(cargoId: string) {
  const [r] = await sqlAdmin`select estatus, saldo::float8 as saldo from v_cargos where id = ${cargoId}`
  return r
}

async function archivosCorreo() {
  try {
    return await readdir(correos)
  } catch {
    return []
  }
}

beforeAll(async () => {
  raiz = await mkdtemp(join(tmpdir(), 'rentas-storage-'))
  correos = await mkdtemp(join(tmpdir(), 'rentas-correos-'))
  process.env.STORAGE_LOCAL_ROOT = raiz
  process.env.EMAIL_LOCAL_DIR = correos
  await resetDb()
  hoy = (await sqlAdmin`select current_date::text as d`)[0].d
})
beforeEach(async () => {
  await sqlAdmin`truncate pago_aplicaciones, pagos, cargos, contratos, unidades, inquilinos, inmuebles,
                 propietario_usuarios, propietarios, usuarios cascade`
  await rm(correos, { recursive: true, force: true })
  ids = await seedUsuarios()
  await sqlAdmin`update propietarios set contacto_email = 'dueno@a.mx', avisos_pago = true where id = ${ids.propietarioA}`
  const [inm] = await sqlAdmin`insert into inmuebles (propietario_id, nombre, tipo, cobrador_id)
    values (${ids.propietarioA}, 'Campana 21', 'edificio', ${ids.equipo}) returning id`
  inmuebleId = inm.id
  const [uni] = await sqlAdmin`insert into unidades (inmueble_id, nombre) values (${inm.id}, 'Depto 3B') returning id`
  const [inq] = await sqlAdmin`insert into inquilinos (nombre) values ('María López') returning id`
  const [c] = await sqlAdmin`insert into contratos (unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago)
    values (${uni.id}, ${inq.id}, current_date - 200, current_date + 30, 10000, 5) returning id`
  contratoId = c.id
  como(ids.equipo)
})
afterAll(async () => {
  await closeSql()
  await closeDb()
  await rm(raiz, { recursive: true, force: true })
  await rm(correos, { recursive: true, force: true })
})

describe('registrarPago', () => {
  it('pago parcial con comprobante: aplica, guarda el comprobante y envía el aviso', async () => {
    const cargoId = await cargo(10000, 10)
    const png = new File([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2])], 'c.png', { type: 'image/png' })
    const pagoId = okId(await cob.registrarPago(pagoFd([cargoId], { referencia: 'REF-1', comprobante: png })))
    expect(await estatus(cargoId)).toEqual({ estatus: 'parcial', saldo: 6000 })

    const [p] = await sqlAdmin`select comprobante_path, registrado_por, metodo, cuenta_destino from pagos where id = ${pagoId}`
    expect(p).toEqual({
      comprobante_path: `propietarios/${ids.propietarioA}/pagos/${pagoId}.png`,
      registrado_por: ids.equipo,
      metodo: 'transferencia',
      cuenta_destino: 'disa',
    })
    expect((await readFile(join(raiz, p.comprobante_path)))[0]).toBe(0x89)

    const [archivo] = await archivosCorreo()
    const correo = JSON.parse(await readFile(join(correos, archivo), 'utf8'))
    expect(correo.to).toBe('dueno@a.mx')
    expect(correo.subject).toBe('Se registró un pago en Campana 21 Depto 3B')
    expect(correo.html).toContain('$4,000.00')
    expect(correo.html).toContain(hoy.split('-').reverse().join('/'))
    expect(correo.html).toContain('REF-1')
  })

  it('sin avisos_pago no envía correo; varios cargos se pagan juntos', async () => {
    await sqlAdmin`update propietarios set avisos_pago = false where id = ${ids.propietarioA}`
    const a = await cargo(10000, -10, 1)
    const b = await cargo(10000, 10)
    okId(await cob.registrarPago(pagoFd([a, b], { monto: '15000' })))
    expect(await estatus(a)).toEqual({ estatus: 'pagado', saldo: 0 })
    expect(await estatus(b)).toEqual({ estatus: 'parcial', saldo: 5000 })
    expect(await archivosCorreo()).toEqual([])
  })

  it('si el correo falla el pago queda registrado', async () => {
    // Un archivo como carpeta de correos: mkdir falla con ENOTDIR.
    const archivo = join(raiz, 'no-es-carpeta')
    await writeFile(archivo, 'x')
    process.env.EMAIL_LOCAL_DIR = join(archivo, 'correos')
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const cargoId = await cargo(10000, 10)
      okId(await cob.registrarPago(pagoFd([cargoId])))
      expect(await estatus(cargoId)).toMatchObject({ estatus: 'parcial' })
      expect(error).toHaveBeenCalled()
    } finally {
      error.mockRestore()
      process.env.EMAIL_LOCAL_DIR = correos
    }
  })

  it('errores de negocio en español', async () => {
    const cargoId = await cargo(10000, 10)
    okId(await cob.registrarPago(pagoFd([cargoId], { referencia: 'REF-1' })))
    expect(await cob.registrarPago(pagoFd([cargoId], { monto: '100', referencia: 'REF-1' }))).toEqual({
      ok: false,
      errores: { referencia: 'Ya existe un pago con esa referencia' },
    })
    expect(await cob.registrarPago(pagoFd([cargoId], { monto: '7000', referencia: 'REF-2' }))).toEqual({
      ok: false,
      errores: { monto: 'El monto excede el saldo de los cargos seleccionados' },
    })
    expect(await cob.registrarPago(pagoFd([cargoId], { monto: '0' }))).toMatchObject({ ok: false, errores: { monto: expect.any(String) } })
    expect(await cob.registrarPago(pagoFd([]))).toEqual({ ok: false, errores: { _form: 'Selecciona al menos un cargo' } })
    expect(await cob.registrarPago(pagoFd(['x']))).toEqual({ ok: false, errores: { _form: 'Cargo inválido' } })
    const txt = new File(['hola'], 'x.txt', { type: 'text/plain' })
    expect(await cob.registrarPago(pagoFd([cargoId], { comprobante: txt }))).toEqual({
      ok: false,
      errores: { comprobante: 'El comprobante debe ser imagen (JPG, PNG, WEBP) o PDF' },
    })
    expect(await estatus(cargoId)).toEqual({ estatus: 'parcial', saldo: 6000 })
  })

  it('si la subida del comprobante falla, el pago queda sin comprobante y con advertencia', async () => {
    const cargoId = await cargo(10000, 10)
    const pdf = new File(['%PDF-1.4\n%%EOF\n'], 'c.pdf', { type: 'application/pdf' })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    storage.falla = true
    try {
      const r = await cob.registrarPago(pagoFd([cargoId], { comprobante: pdf }))
      expect(r).toEqual({
        ok: true,
        id: expect.any(String),
        advertencia: 'El pago se registró pero no se pudo guardar el comprobante',
      })
      const [p] = await sqlAdmin`select comprobante_path, cancelado from pagos where id = ${okId(r)}`
      expect(p).toEqual({ comprobante_path: null, cancelado: false })
      expect(await estatus(cargoId)).toEqual({ estatus: 'parcial', saldo: 6000 })
      expect(error).toHaveBeenCalled()
      expect(await archivosCorreo()).toHaveLength(1)
    } finally {
      storage.falla = false
      error.mockRestore()
    }
  })

  it('registrar_comprobante_pago: sólo la ruta canónica de un pago vigente, sólo equipo/admin', async () => {
    const cargoId = await cargo(10000, 10)
    const pagoId = okId(await cob.registrarPago(pagoFd([cargoId])))
    const ruta = `propietarios/${ids.propietarioA}/pagos/${pagoId}.pdf`
    const fijar = (usuario: string, path: string) =>
      asUser(usuario, (s) => s`select registrar_comprobante_pago(${pagoId}, ${path})`)
    for (const mala of [
      `propietarios/${ids.propietarioB}/pagos/${pagoId}.pdf`,
      `propietarios/${ids.propietarioA}/contratos/${pagoId}.pdf`,
      `propietarios/${ids.propietarioA}/pagos/${pagoId}.pdf/../../x`,
      `${ruta}x/y`,
    ]) {
      await expect(fijar(ids.equipo, mala)).rejects.toThrow('RUTA_INVALIDA')
    }
    await expect(fijar(ids.propA, ruta)).rejects.toThrow('SOLO_EQUIPO')
    await fijar(ids.equipo, ruta)
    okId(await cob.cancelarPago(pagoId, 'Error'))
    await expect(fijar(ids.equipo, ruta)).rejects.toThrow('PAGO_CANCELADO')
    const [p] = await sqlAdmin`select comprobante_path from pagos where id = ${pagoId}`
    expect(p.comprobante_path).toBe(ruta)
  })

  it('un propietario es rechazado (403)', async () => {
    const cargoId = await cargo(10000, 10)
    como(ids.propA)
    await expect(cob.registrarPago(pagoFd([cargoId]))).rejects.toThrow(FORBIDDEN)
    await expect(cob.cancelarPago(cargoId, 'x')).rejects.toThrow(FORBIDDEN)
    await expect(cob.actualizarNotaCargo(cargoId, 'x')).rejects.toThrow(FORBIDDEN)
    await expect(cob.actualizarMontoCargo(cargoId, '1')).rejects.toThrow(FORBIDDEN)
    await expect(cob.generarCargosMes()).rejects.toThrow(FORBIDDEN)
    const [{ n }] = await sqlAdmin`select count(*)::int as n from pagos`
    expect(n).toBe(0)
  })
})

describe('cancelarPago, notas, monto y generar cargos', () => {
  it('cancelar con motivo regresa el cargo a pendiente; sin motivo y doble cancelación → mensajes', async () => {
    const cargoId = await cargo(10000, 10)
    const pagoId = okId(await cob.registrarPago(pagoFd([cargoId])))
    expect(await cob.cancelarPago(pagoId, '  ')).toEqual({
      ok: false,
      errores: { _form: 'Indica el motivo de la cancelación' },
    })
    expect(await cob.actualizarMontoCargo(cargoId, '9000')).toEqual({
      ok: false,
      errores: { _form: 'El cargo ya tiene pagos; cancélalos primero' },
    })
    expect(okId(await cob.cancelarPago(pagoId, 'Error de captura'))).toBe(pagoId)
    expect(await estatus(cargoId)).toEqual({ estatus: 'pendiente', saldo: 10000 })
    expect(await cob.cancelarPago(pagoId, 'otra vez')).toEqual({
      ok: false,
      errores: { _form: 'El pago ya estaba cancelado' },
    })
    okId(await cob.actualizarMontoCargo(cargoId, '9,500'))
    expect(await estatus(cargoId)).toEqual({ estatus: 'pendiente', saldo: 9500 })
  })

  it('equipo edita la nota del cargo', async () => {
    const cargoId = await cargo(10000, 10)
    okId(await cob.actualizarNotaCargo(cargoId, ' Paga el viernes '))
    const [c] = await sqlAdmin`select notas from cargos where id = ${cargoId}`
    expect(c.notas).toBe('Paga el viernes')
    okId(await cob.actualizarNotaCargo(cargoId, ''))
    const [d] = await sqlAdmin`select notas from cargos where id = ${cargoId}`
    expect(d.notas).toBeNull()
  })

  it('generarCargosMes: sólo admin; devuelve el número de cargos creados en id', async () => {
    await expect(cob.generarCargosMes()).rejects.toThrow(FORBIDDEN)
    como(ids.admin)
    expect(await cob.generarCargosMes()).toEqual({ ok: true, id: '1' })
    expect(await cob.generarCargosMes()).toEqual({ ok: true, id: '0' })
  })
})

describe('consultas de cobranza y tablero', () => {
  it('cargosDelMes filtra por cobrador (por defecto el usuario) y trae pagos; tablero arma los bloques', async () => {
    const vencido = await cargo(10000, -10, 1)
    const actual = await cargo(10000, 10)
    const pagoId = okId(await cob.registrarPago(pagoFd([actual], { referencia: 'R1' })))
    const sesion = (await cargarSesion(ids.equipo))!

    const filas = await cargosDelMes(sesion, {})
    expect(filas.map((f) => f.id)).toEqual([actual])
    expect(filas[0]).toMatchObject({
      inmueble_nombre: 'Campana 21',
      unidad_nombre: 'Depto 3B',
      inquilino_nombre: 'María López',
      propietario_nombre: 'A',
      estatus: 'parcial',
    })
    expect(filas[0].pagos.map((p) => p.id)).toEqual([pagoId])

    const anterior = await cargosDelMes(sesion, { periodo: (await sqlAdmin`select to_char(current_date - interval '1 month', 'YYYY-MM') as p`)[0].p })
    expect(anterior.map((f) => f.id)).toEqual([vencido])

    await sqlAdmin`update inmuebles set cobrador_id = ${ids.admin} where id = ${inmuebleId}`
    expect(await cargosDelMes(sesion, { cobradorId: ids.equipo })).toEqual([])
    // Ya no cobra ningún inmueble: por defecto ve todos; "Todos" (null) también.
    expect((await cargosDelMes(sesion, {})).map((f) => f.id)).toEqual([actual])
    expect((await cargosDelMes(sesion, { cobradorId: null })).map((f) => f.id)).toEqual([actual])
    expect(await cargosDelMes(sesion, { cobradorId: null, estatus: 'pendiente' })).toEqual([])

    const t = await tablero(sesion)
    expect(t.vencidos.map((v) => [v.id, v.dias_atraso, v.unidad_nombre])).toEqual([[vencido, 10, 'Depto 3B']])
    expect(t.pagosHoy.map((p) => p.id)).toEqual([pagoId])
    expect(t.contratosPorVencer.map((c) => c.id)).toEqual([contratoId])
    expect(t.liquidacionesPendientes.map((l) => l.nombre)).toEqual(['A', 'B'])

    // Pendientes = liquidaciones del MES ANTERIOR (el mes en curso aún no se puede cerrar).
    await sqlAdmin`insert into liquidaciones (propietario_id, periodo, estatus, modelo, comision_pct) values
      (${ids.propietarioA}, (date_trunc('month', current_date) - interval '1 month')::date, 'cerrada', 'cobra_disa', 15),
      (${ids.propietarioB}, date_trunc('month', current_date)::date, 'cerrada', 'cobra_disa', 12)`
    expect((await tablero(sesion)).liquidacionesPendientes.map((l) => l.nombre)).toEqual(['B'])
  })
})
