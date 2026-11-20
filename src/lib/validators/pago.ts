import { z } from 'zod'
import { enumeracion, fecha, numero, textoOpcional, validar } from './comun'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const METODOS_PAGO = ['transferencia', 'deposito', 'efectivo', 'otro'] as const
export const CUENTAS_DESTINO = ['disa', 'propietario'] as const

export const montoPositivo = () => numero().refine((n) => n > 0, 'El monto debe ser mayor a cero')

export const pagoSchema = z.object({
  cargoIds: z
    .array(z.string().regex(UUID, 'Cargo inválido'), { error: 'Selecciona al menos un cargo' })
    .min(1, 'Selecciona al menos un cargo')
    .max(50, 'Demasiados cargos'),
  monto: montoPositivo(),
  fecha: fecha(),
  metodo: enumeracion(METODOS_PAGO, 'Elige el método de pago'),
  referencia: textoOpcional(100).transform((v) => v ?? ''),
  cuenta: enumeracion(CUENTAS_DESTINO, 'Elige la cuenta destino'),
})

/** FormData del registro de pago: `cargoIds` llega repetido (uno por cargo). */
export function validarPago(formData: FormData) {
  const datos: Record<string, unknown> = {}
  for (const [k, v] of formData.entries()) if (typeof v === 'string' && k !== 'cargoIds') datos[k] = v
  datos.cargoIds = [...new Set(formData.getAll('cargoIds').filter((v) => typeof v === 'string'))]
  const v = validar(pagoSchema, datos)
  // El diálogo no tiene campo visible para los cargos: su error va arriba del botón.
  if (!v.ok && v.errores.cargoIds) {
    const { cargoIds, ...resto } = v.errores
    return { ok: false as const, errores: { _form: resto._form ?? cargoIds, ...resto } }
  }
  return v
}
