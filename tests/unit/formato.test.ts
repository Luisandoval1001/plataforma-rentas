import { describe, expect, it } from 'vitest'
import { dinero, fecha, hoyIso, mesActualIso, mesAnteriorIso, porcentaje } from '@/lib/formato'

describe('formato', () => {
  it('fecha dd/mm/yyyy desde Date UTC o texto', () => {
    expect(fecha(new Date('2026-03-01T00:00:00Z'))).toBe('01/03/2026')
    expect(fecha('2026-12-31')).toBe('31/12/2026')
    expect(fecha(null)).toBe('')
  })

  it('dinero $#,##0.00', () => {
    expect(dinero('18000')).toBe('$18,000.00')
    expect(dinero(1234567.5)).toBe('$1,234,567.50')
    expect(dinero(-1392)).toBe('-$1,392.00')
    expect(dinero(0)).toBe('$0.00')
  })

  it('porcentaje', () => {
    expect(porcentaje('15.00')).toBe('15%')
    expect(porcentaje(12.5)).toBe('12.5%')
  })

  it('hoy y mes en curso en hora de la Ciudad de México, no del reloj del proceso', () => {
    const nocheMx = new Date('2026-11-04T00:30:00Z') // 3 nov, 18:30 en CDMX
    expect(hoyIso(nocheMx)).toBe('2026-11-03')
    expect(mesActualIso(new Date('2026-12-01T05:00:00Z'))).toBe('2026-11')
  })

  it('mes anterior en hora de la Ciudad de México (default de liquidaciones)', () => {
    expect(mesAnteriorIso(new Date('2026-11-04T00:30:00Z'))).toBe('2026-10')
    expect(mesAnteriorIso(new Date('2026-12-01T05:00:00Z'))).toBe('2026-10') // aún 30 nov en CDMX
    expect(mesAnteriorIso(new Date('2027-01-15T12:00:00Z'))).toBe('2026-12')
  })
})
