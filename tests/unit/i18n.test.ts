import { describe, expect, it } from 'vitest'
import { en } from '@/lib/i18n/en'
import { es } from '@/lib/i18n/es'
import { idiomaValido, nombreMes, t } from '@/lib/i18n'

describe('i18n', () => {
  it('traduce estatus al inglés', () => {
    expect(t('en', 'estatus.vencido')).toBe('Overdue')
    expect(t('es', 'estatus.vencido')).toBe('Vencido')
    expect(t('en', 'estatus.pagado')).toBe('Paid')
    expect(t('es', 'estatus.parcial')).toBe('Pago parcial')
  })

  it('toda clave de es existe en en (y no sobra ninguna)', () => {
    for (const clave of Object.keys(es)) {
      expect(en, clave).toHaveProperty([clave])
      expect((en as Record<string, string>)[clave], clave).not.toBe('')
    }
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort())
  })

  it('interpola variables', () => {
    expect(t('es', 'resumen.diasAtraso', { n: 3 })).toBe('3 días de atraso')
    expect(t('en', 'resumen.diasAtraso', { n: 3 })).toBe('3 days overdue')
  })

  it('nombre de mes por idioma y validación de idioma', () => {
    expect(nombreMes('es', '2026-10')).toBe('Octubre 2026')
    expect(nombreMes('en', '2026-10-01')).toBe('October 2026')
    expect(idiomaValido('en')).toBe('en')
    expect(idiomaValido('fr')).toBe('es')
    expect(idiomaValido(undefined)).toBe('es')
  })
})
