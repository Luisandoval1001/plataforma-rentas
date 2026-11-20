import { z } from 'zod'
import { entero, fecha, id, idOpcional, numero, numeroConDefecto, textoOpcional } from './comun'

/**
 * Alta de contrato. El inquilino es uno existente (`inquilino_id`) o uno nuevo capturado en el
 * mismo formulario (`inquilino_nombre`, `inquilino_email`, `inquilino_telefono`, `inquilino_rfc`).
 */
export const contratoSchema = z
  .object({
    unidad_id: id('Selecciona la unidad'),
    inquilino_id: idOpcional(),
    inquilino_nombre: textoOpcional(),
    inquilino_email: textoOpcional().refine((v) => v === null || z.email().safeParse(v).success, 'Correo inválido'),
    inquilino_telefono: textoOpcional(40),
    inquilino_rfc: textoOpcional(13).transform((v) => v?.toUpperCase() ?? null),
    fecha_inicio: fecha(),
    fecha_fin: fecha(),
    renta_mensual: numero().pipe(z.number().positive('Debe ser mayor a 0').max(9_999_999_999, 'Monto demasiado grande')),
    dia_pago: entero().pipe(z.number().min(1, 'Debe estar entre 1 y 28').max(28, 'Debe estar entre 1 y 28')),
    deposito: numeroConDefecto(0).pipe(z.number().min(0, 'No puede ser negativo').max(9_999_999_999, 'Monto demasiado grande')),
    incremento_anual_pct: numeroConDefecto(0).pipe(z.number().min(0, 'Entre 0 y 100').max(100, 'Entre 0 y 100')),
  })
  .superRefine((c, ctx) => {
    if (c.fecha_fin < c.fecha_inicio) {
      ctx.addIssue({ code: 'custom', path: ['fecha_fin'], message: 'Debe ser igual o posterior a la fecha de inicio' })
    }
    if (!c.inquilino_id && !c.inquilino_nombre) {
      ctx.addIssue({ code: 'custom', path: ['inquilino_id'], message: 'Selecciona un inquilino o captura uno nuevo' })
    }
  })

export type ContratoDatos = z.output<typeof contratoSchema>
