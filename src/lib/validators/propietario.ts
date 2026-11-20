import { z } from 'zod'
import { casilla, enumeracion, numero, texto, textoOpcional } from './comun'

export const MODELOS = ['cobra_disa', 'cobra_propietario'] as const
export const IDIOMAS = ['es', 'en'] as const

export const propietarioSchema = z.object({
  nombre: texto(),
  rfc: textoOpcional(13).transform((v) => v?.toUpperCase() ?? null),
  modelo: enumeracion(MODELOS, 'Selecciona el modelo de dinero'),
  comision_pct: numero().pipe(z.number().min(0, 'Entre 0 y 100').max(100, 'Entre 0 y 100')),
  cuenta_ultimos4: textoOpcional(4).refine((v) => v === null || /^\d{4}$/.test(v), 'Sólo 4 dígitos'),
  recargo_visible: casilla(),
  recargos_al_propietario: casilla(),
  idioma: z.preprocess((v) => (v === undefined || v === '' ? 'es' : v), z.enum(IDIOMAS, { error: 'Idioma inválido' })),
  avisos_pago: casilla(),
  avisos_estado_cuenta: casilla(),
  avisos_contrato: casilla(),
  contacto_email: textoOpcional().refine((v) => v === null || z.email().safeParse(v).success, 'Correo inválido'),
  contacto_tel: textoOpcional(40),
})

export type PropietarioDatos = z.output<typeof propietarioSchema>

export const invitacionSchema = z.object({
  nombre: texto(),
  email: texto()
    .transform((v) => v.toLowerCase())
    .refine((v) => z.email().safeParse(v).success, 'Correo inválido'),
})
