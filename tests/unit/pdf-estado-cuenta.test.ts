import { PDFParse } from 'pdf-parse'
import { describe, expect, it } from 'vitest'
import { renderEstadoCuentaPdf, type EstadoCuentaData } from '@/lib/pdf/estado-cuenta'

async function texto(pdf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(pdf) })
  try {
    return (await parser.getText()).text
  } finally {
    await parser.destroy()
  }
}

// Escenario A de la Tarea 4 (marzo, cobra_disa 15%).
const A: EstadoCuentaData = {
  propietario: { nombre: 'Inmobiliaria A', rfc: 'AAA010101AAA' },
  periodo: '2026-03',
  modelo: 'cobra_disa',
  comisionPct: 15,
  lineas: [
    { tipo: 'cobro', descripcion: 'Renta Depto 101 2026-03 — pago 2026-03-03', monto: 10000 },
    { tipo: 'gasto_disa', descripcion: 'Plomería — Torre (2026-03-10)', monto: 1000 },
    { tipo: 'gasto_propietario', descripcion: 'Plomería — Torre (2026-03-20)', monto: 500 },
  ],
  totales: { cobrado: 10000, cobradoDisa: 10000, comision: 1500, iva: 240, gastosDisa: 1000, gastosPropietario: 500, ajustes: 0, neto: 7260 },
}

describe('renderEstadoCuentaPdf', () => {
  it('escenario A: PDF con encabezado, líneas, totales y neto a favor del propietario', async () => {
    const pdf = await renderEstadoCuentaPdf(A, 'es')
    expect(Buffer.isBuffer(pdf)).toBe(true)
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF')
    const t = await texto(pdf)
    expect(t).toContain('Casas y Terrenos DISA — Estado de cuenta')
    expect(t).toContain('Inmobiliaria A')
    expect(t).toContain('AAA010101AAA')
    expect(t).toContain('2026-03')
    expect(t).toContain('15%')
    expect(t).toContain('Plomería — Torre (2026-03-10)')
    expect(t).toContain('$10,000.00')
    expect(t).toContain('$1,500.00')
    expect(t).toContain('$240.00')
    expect(t).toContain('7,260.00')
    expect(t).toContain('Neto a favor del propietario')
    expect(t).not.toContain('Saldo a favor de DISA')
  })

  it('cuentas mezcladas: muestra lo cobrado en cuenta DISA (base del neto)', async () => {
    const M: EstadoCuentaData = {
      ...A,
      lineas: [],
      totales: { cobrado: 20000, cobradoDisa: 10000, comision: 3000, iva: 480, gastosDisa: 0, gastosPropietario: 0, ajustes: 0, neto: 6520 },
    }
    const es = await texto(await renderEstadoCuentaPdf(M, 'es'))
    expect(es).toContain('Cobrado en cuenta DISA')
    expect(es).toContain('$20,000.00')
    expect(es).toContain('6,520.00')
    expect(await texto(await renderEstadoCuentaPdf(M, 'en'))).toContain('Collected into DISA account')
  })

  it('neto negativo (escenario B): saldo a favor de DISA', async () => {
    const B: EstadoCuentaData = {
      ...A,
      modelo: 'cobra_propietario',
      comisionPct: 12,
      lineas: [{ tipo: 'cobro', descripcion: 'Renta Depto 101 2026-03', monto: 10000 }],
      totales: { cobrado: 10000, cobradoDisa: 0, comision: 1200, iva: 192, gastosDisa: 0, gastosPropietario: 0, ajustes: 0, neto: -1392 },
    }
    const t = await texto(await renderEstadoCuentaPdf(B, 'es'))
    expect(t).toContain('Saldo a favor de DISA')
    expect(t).toContain('1,392.00')
    expect(t).not.toContain('Neto a favor del propietario')
  })

  it('sin líneas y totales en cero renderiza', async () => {
    const vacio: EstadoCuentaData = {
      ...A,
      lineas: [],
      totales: { cobrado: 0, cobradoDisa: 0, comision: 0, iva: 0, gastosDisa: 0, gastosPropietario: 0, ajustes: 0, neto: 0 },
    }
    const pdf = await renderEstadoCuentaPdf(vacio, 'es')
    expect(pdf.subarray(0, 4).toString('latin1')).toBe('%PDF')
    const t = await texto(pdf)
    expect(t).toContain('$0.00')
    expect(t).toContain('Neto a favor del propietario')
  })

  it('en inglés', async () => {
    const t = await texto(await renderEstadoCuentaPdf(A, 'en'))
    expect(t).toContain('Casas y Terrenos DISA — Account statement')
    expect(t).toContain('Net in favor of the owner')
  })
})
