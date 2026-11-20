import { describe, expect, it } from 'vitest'
import { contratoSchema } from '@/lib/validators/contrato'
import { inmuebleSchema } from '@/lib/validators/inmueble'
import { inquilinoSchema } from '@/lib/validators/inquilino'
import { propietarioSchema } from '@/lib/validators/propietario'
import { unidadSchema } from '@/lib/validators/unidad'
import { validar } from '@/lib/validators/comun'

const UNIDAD = '00000000-0000-0000-0000-000000000001'
const INQUILINO = '00000000-0000-0000-0000-000000000002'

const contratoBase = {
  unidad_id: UNIDAD,
  inquilino_id: INQUILINO,
  fecha_inicio: '2026-11-01',
  fecha_fin: '2027-10-31',
  renta_mensual: '18,000',
  dia_pago: '5',
}

const propietarioBase = { nombre: 'Villalongin', modelo: 'cobra_disa', comision_pct: '15' }

describe('validadores', () => {
  describe('contrato', () => {
    it('acepta un contrato válido y normaliza números', () => {
      const r = validar(contratoSchema, contratoBase)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.data.renta_mensual).toBe(18000)
      expect(r.data.dia_pago).toBe(5)
      expect(r.data.deposito).toBe(0)
      expect(r.data.incremento_anual_pct).toBe(0)
    })

    it('rechaza dia_pago 0', () => {
      const r = validar(contratoSchema, { ...contratoBase, dia_pago: '0' })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.errores.dia_pago).toMatch(/entre 1 y 28/)
    })

    it('rechaza fecha_fin anterior a fecha_inicio', () => {
      const r = validar(contratoSchema, { ...contratoBase, fecha_fin: '2026-10-31' })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.errores.fecha_fin).toMatch(/posterior/)
    })

    it('exige inquilino existente o nombre de inquilino nuevo', () => {
      const sinInquilino = validar(contratoSchema, { ...contratoBase, inquilino_id: '' })
      expect(sinInquilino.ok).toBe(false)
      if (!sinInquilino.ok) expect(sinInquilino.errores.inquilino_id).toBeDefined()

      const nuevo = validar(contratoSchema, {
        ...contratoBase,
        inquilino_id: '',
        inquilino_nombre: 'Juan Pérez',
      })
      expect(nuevo.ok).toBe(true)
    })
  })

  describe('propietario', () => {
    it('acepta un propietario válido; casillas ausentes = false', () => {
      const r = validar(propietarioSchema, { ...propietarioBase, avisos_pago: 'on' })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.data.comision_pct).toBe(15)
      expect(r.data.idioma).toBe('es')
      expect(r.data.avisos_pago).toBe(true)
      expect(r.data.recargo_visible).toBe(false)
      expect(r.data.rfc).toBeNull()
    })

    it('rechaza comision_pct 101', () => {
      const r = validar(propietarioSchema, { ...propietarioBase, comision_pct: '101' })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.errores.comision_pct).toBeDefined()
    })

    it("rechaza idioma 'fr'", () => {
      const r = validar(propietarioSchema, { ...propietarioBase, idioma: 'fr' })
      expect(r.ok).toBe(false)
      if (r.ok) return
      expect(r.errores.idioma).toBeDefined()
    })
  })

  describe('inmueble, unidad e inquilino', () => {
    it('exigen nombre', () => {
      const inm = validar(inmuebleSchema, { nombre: ' ', tipo: 'edificio', propietario_id: UNIDAD })
      const uni = validar(unidadSchema, { nombre: '' })
      const inq = validar(inquilinoSchema, { nombre: '' })
      for (const r of [inm, uni, inq]) {
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.errores.nombre).toBe('Requerido')
      }
    })

    it('acepta FormData', () => {
      const fd = new FormData()
      fd.set('nombre', 'Orizaba 36')
      fd.set('tipo', 'edificio')
      fd.set('propietario_id', UNIDAD)
      fd.set('cobrador_id', '')
      const r = validar(inmuebleSchema, fd)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.data.cobrador_id).toBeNull()
    })
  })
})

describe('leerPdf', () => {
  it('vacío opcional → null; vacío requerido → error; no-PDF → error; PDF → Buffer', async () => {
    const { leerPdf } = await import('@/lib/validators/archivo')
    const fd = new FormData()
    expect(await leerPdf(fd, 'pdf', false)).toEqual({ ok: true, data: null })
    expect((await leerPdf(fd, 'pdf', true)).ok).toBe(false)

    fd.set('pdf', new File(['hola'], 'x.pdf', { type: 'application/pdf' }))
    const noPdf = await leerPdf(fd, 'pdf', false)
    expect(noPdf.ok).toBe(false)
    if (!noPdf.ok) expect(noPdf.errores.pdf).toBe('El archivo no es un PDF')

    fd.set('pdf', new File(['%PDF-1.4\n'], 'x.pdf', { type: 'application/pdf' }))
    const ok = await leerPdf(fd, 'pdf', true)
    expect(ok.ok && ok.data?.length).toBe(9)
  })
})

describe('tope de 4 MB por archivo (Vercel limita el cuerpo de la petición a ~4.5 MB)', () => {
  const MENSAJE = 'El archivo debe pesar menos de 4 MB; reduce la resolución o comprime el PDF'
  const grande = (cabecera: string) => new File([cabecera, Buffer.alloc(4 * 1024 * 1024 + 1 - cabecera.length)], 'g', {})
  const conCampo = (campo: string, f: File) => {
    const fd = new FormData()
    fd.set(campo, f)
    return fd
  }

  it('PDF, comprobante, XML y documento mayores a 4 MB se rechazan con el mismo mensaje', async () => {
    const { leerPdf, leerComprobante, leerXml, leerArchivoDocumento, ARCHIVO_MAX_BYTES } = await import('@/lib/validators/archivo')
    expect(ARCHIVO_MAX_BYTES).toBe(4 * 1024 * 1024)
    expect(await leerPdf(conCampo('pdf', grande('%PDF-')), 'pdf', true)).toEqual({ ok: false, errores: { pdf: MENSAJE } })
    expect(await leerComprobante(conCampo('c', grande('%PDF-')), 'c')).toEqual({ ok: false, errores: { c: MENSAJE } })
    expect(await leerXml(conCampo('x', grande('<?xml')), 'x')).toEqual({ ok: false, errores: { x: MENSAJE } })
    expect(await leerArchivoDocumento(conCampo('a', grande('%PDF-')), 'a')).toEqual({ ok: false, errores: { a: MENSAJE } })
  })

  it('exactamente 4 MB se acepta', async () => {
    const { leerPdf } = await import('@/lib/validators/archivo')
    const justo = new File(['%PDF-', Buffer.alloc(4 * 1024 * 1024 - 5)], 'j.pdf')
    expect((await leerPdf(conCampo('pdf', justo), 'pdf', true)).ok).toBe(true)
  })
})
