import { z } from 'zod'
import { texto } from './comun'

export const unidadSchema = z.object({ nombre: texto() })
