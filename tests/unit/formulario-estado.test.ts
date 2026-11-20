import { describe, expect, it } from 'vitest'
import { envioBloqueado } from '@/components/ui/formulario-estado'
import type { Resultado } from '@/lib/acciones'

describe('envioBloqueado (Formulario)', () => {
  const conAdvertencia: Resultado = { ok: true, id: 'p1', advertencia: 'El pago se registró pero no se pudo guardar el comprobante' }

  it('tras un éxito con advertencia, el envío queda bloqueado hasta "Entendido" (no se duplica el pago)', () => {
    expect(envioBloqueado(conAdvertencia, null)).toBe(true)
    expect(envioBloqueado(conAdvertencia, conAdvertencia)).toBe(false)
  })

  it('sin resultado, con error o con éxito limpio no bloquea', () => {
    expect(envioBloqueado(null, null)).toBe(false)
    expect(envioBloqueado({ ok: false, errores: { monto: 'x' } }, null)).toBe(false)
    expect(envioBloqueado({ ok: true, id: 'p1' }, null)).toBe(false)
  })

  it('una advertencia nueva (otro resultado) vuelve a bloquear', () => {
    const otra: Resultado = { ...conAdvertencia }
    expect(envioBloqueado(otra, conAdvertencia)).toBe(true)
  })
})
