import { z } from 'zod'
import { fecha, numero, texto, textoOpcional } from './comun'

const PERIODO = /^\d{4}-(0[1-9]|1[0-2])$/

/** 'YYYY-MM' (valor de <input type="month">). */
export const periodo = () =>
  z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().regex(PERIODO, 'Periodo inválido'))

export const pagoLiquidacionSchema = z.object({
  fecha: fecha(),
  referencia: textoOpcional(100).transform((v) => v ?? ''),
})

export const ajusteSchema = z.object({
  monto: numero().refine((n) => n !== 0, 'El monto no puede ser cero'),
  descripcion: texto(),
})
