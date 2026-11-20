import { z } from 'zod'
import { casilla, enumeracion, idOpcional, texto } from './comun'

export const TIPOS_DOCUMENTO = ['factura', 'reporte', 'contrato', 'comprobante', 'otro'] as const
export const TIPO_DOCUMENTO_TEXTO = {
  factura: 'Factura',
  reporte: 'Reporte',
  contrato: 'Contrato',
  comprobante: 'Comprobante',
  otro: 'Otro',
} as const

export const documentoSchema = z.object({
  tipo: enumeracion(TIPOS_DOCUMENTO, 'Elige el tipo'),
  nombre: texto(),
  unidadId: idOpcional(),
  pagoId: idOpcional(),
  liquidacionId: idOpcional(),
  visiblePropietario: casilla(),
})

export const metadatosDocumentoSchema = documentoSchema.pick({ tipo: true, nombre: true, visiblePropietario: true })
