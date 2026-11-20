import { z } from 'zod'
import { enumeracion, fecha, id, idOpcional, texto, textoOpcional } from './comun'
import { montoPositivo } from './pago'

export const PAGADO_POR = ['disa', 'propietario'] as const
export const PAGADO_POR_TEXTO = { disa: 'DISA', propietario: 'Propietario' } as const

export const gastoSchema = z.object({
  inmuebleId: id('Selecciona el inmueble'),
  unidadId: idOpcional(),
  fecha: fecha(),
  concepto: texto(),
  monto: montoPositivo(),
  pagadoPor: enumeracion(PAGADO_POR, 'Indica quién pagó'),
  autorizadoPor: textoOpcional(100),
})
