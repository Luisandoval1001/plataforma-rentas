import { z } from 'zod'

const texto = z.string().min(1, 'obligatorio')
const opcional = z.string().transform((v) => (v === '' ? null : v))
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha inválida (YYYY-MM-DD)')
  .refine((v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().startsWith(v), 'fecha inexistente')
const numero = z.string().regex(/^\d+(\.\d+)?$/, 'número inválido')
const bool = z.string().transform((v, ctx) => {
  const s = v.toLowerCase()
  if (s === '' || ['false', 'no', '0'].includes(s)) return false
  if (['true', 'si', 'sí', '1'].includes(s)) return true
  ctx.addIssue({ code: 'custom', message: 'booleano inválido (true/false)' })
  return z.NEVER
})

export const propietarios = z.object({
  ref: texto, nombre: texto, rfc: opcional,
  modelo: z.enum(['cobra_disa', 'cobra_propietario']),
  comision_pct: numero.refine((v) => Number(v) <= 100, 'debe estar entre 0 y 100'),
  contacto_email: opcional, contacto_tel: opcional,
  idioma: z.enum(['es', 'en']), recargo_visible: bool, recargos_al_propietario: bool,
})
export const inmuebles = z.object({
  ref: texto, propietario_ref: texto, nombre: texto, direccion: opcional,
  tipo: z.enum(['departamento', 'casa', 'edificio', 'local', 'terreno', 'nave', 'otro']),
})
export const unidades = z.object({ ref: texto, inmueble_ref: texto, nombre: texto })
export const inquilinos = z.object({ ref: texto, nombre: texto, email: opcional, telefono: opcional, rfc: opcional })
export const contratos = z.object({
  ref: texto, unidad_ref: texto, inquilino_ref: texto, fecha_inicio: fecha, fecha_fin: fecha,
  renta_mensual: numero.refine((v) => Number(v) > 0, 'debe ser mayor a 0'),
  dia_pago: z.string().regex(/^\d+$/, 'entero inválido').transform(Number)
    .refine((n) => n >= 1 && n <= 28, 'dia_pago debe estar entre 1 y 28'),
  deposito: numero.or(z.literal('').transform(() => '0')),
  incremento_anual_pct: numero.or(z.literal('').transform(() => '0')),
  estatus: z.enum(['vigente', 'pendiente_firma', 'terminado']),
  // Opcional (columna o valor vacío): primer mes que el sistema cobra; por omisión, el de fecha_inicio.
  primer_periodo_cargo: z.string().regex(/^(\d{4}-(0[1-9]|1[0-2]))?$/, 'periodo inválido (YYYY-MM)').optional()
    .transform((v) => (v ? v : null)),
})
  .refine((c) => c.fecha_fin >= c.fecha_inicio, { path: ['fecha_fin'], message: 'fecha_fin anterior a fecha_inicio' })
  .refine((c) => c.primer_periodo_cargo === null || c.primer_periodo_cargo >= c.fecha_inicio.slice(0, 7), {
    path: ['primer_periodo_cargo'], message: 'anterior al mes de fecha_inicio',
  })
export const saldos = z.object({
  ref: texto, contrato_ref: texto,
  periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'periodo inválido (YYYY-MM)'),
  monto: numero.refine((v) => Number(v) > 0, 'debe ser mayor a 0'),
  descripcion: opcional,
})
