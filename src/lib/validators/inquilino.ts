import { z } from 'zod'
import { texto, textoOpcional } from './comun'

export const inquilinoSchema = z.object({
  nombre: texto(),
  email: textoOpcional().refine((v) => v === null || z.email().safeParse(v).success, 'Correo inválido'),
  telefono: textoOpcional(40),
  rfc: textoOpcional(13).transform((v) => v?.toUpperCase() ?? null),
})

export type InquilinoDatos = z.output<typeof inquilinoSchema>
