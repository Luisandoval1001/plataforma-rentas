import { z } from 'zod'
import { enumeracion, id, idOpcional, texto, textoOpcional } from './comun'

export const TIPOS_INMUEBLE = ['departamento', 'casa', 'edificio', 'local', 'terreno', 'nave', 'otro'] as const

/** Edición: el propietario no se cambia desde la app. */
export const inmuebleEdicionSchema = z.object({
  nombre: texto(),
  direccion: textoOpcional(300),
  tipo: enumeracion(TIPOS_INMUEBLE, 'Selecciona el tipo'),
  cobrador_id: idOpcional(),
})

export const inmuebleSchema = inmuebleEdicionSchema.extend({
  propietario_id: id('Selecciona el propietario'),
})
