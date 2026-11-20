import { z } from 'zod'

export type Errores = Record<string, string>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** '' o sólo espacios → undefined, para que los campos opcionales queden vacíos. */
function vacioAIndefinido(v: unknown) {
  if (typeof v !== 'string') return v
  const t = v.trim()
  return t === '' ? undefined : t
}

/** Texto obligatorio (recortado). */
export const texto = () =>
  z.preprocess((v) => vacioAIndefinido(v) ?? '', z.string().min(1, 'Requerido').max(200, 'Máximo 200 caracteres'))

/** Texto opcional: vacío → null. */
export const textoOpcional = (max = 200) =>
  z.preprocess(
    (v) => vacioAIndefinido(v) ?? null,
    z.string().max(max, `Máximo ${max} caracteres`).nullable(),
  )

/** Número escrito por una persona: acepta "18,000", "$18,000.50" y espacios. */
function aNumero(v: unknown) {
  const t = vacioAIndefinido(v)
  if (typeof t !== 'string') return t
  const limpio = t.replace(/[$,\s]/g, '')
  return limpio === '' ? undefined : Number(limpio)
}

export const numero = (mensaje = 'Escribe un número') =>
  z.preprocess(aNumero, z.number({ error: mensaje }).refine(Number.isFinite, mensaje))

export const entero = (mensaje = 'Escribe un número entero') =>
  z.preprocess(aNumero, z.number({ error: mensaje }).int(mensaje))

/** Número opcional con valor por defecto. */
export const numeroConDefecto = (defecto: number, mensaje = 'Escribe un número') =>
  z.preprocess((v) => aNumero(v) ?? defecto, z.number({ error: mensaje }).refine(Number.isFinite, mensaje))

/** Casilla HTML: presente ('on'/'true') → true; ausente → false. */
export const casilla = () => z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean())

/** Fecha yyyy-mm-dd válida. */
export const fecha = () =>
  z.preprocess(
    (v) => vacioAIndefinido(v) ?? '',
    z
      .string()
      .min(1, 'Requerido')
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida')
      .refine((s) => {
        const d = new Date(`${s}T00:00:00Z`)
        return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s)
      }, 'Fecha inválida'),
  )

export const id = (mensaje = 'Selecciona una opción') =>
  z.preprocess((v) => vacioAIndefinido(v) ?? '', z.string().regex(UUID, mensaje))

export const idOpcional = () =>
  z.preprocess((v) => vacioAIndefinido(v) ?? null, z.string().regex(UUID, 'Opción inválida').nullable())

export function enumeracion<const T extends readonly [string, ...string[]]>(valores: T, mensaje = 'Opción inválida') {
  return z.preprocess((v) => vacioAIndefinido(v) ?? '', z.enum(valores, { error: mensaje }))
}

/** Campos de texto de un FormData (los File se ignoran). */
function aObjeto(entrada: FormData | Record<string, unknown>): Record<string, unknown> {
  if (!(entrada instanceof FormData)) return entrada
  const obj: Record<string, unknown> = {}
  for (const [k, v] of entrada.entries()) if (typeof v === 'string') obj[k] = v
  return obj
}

export type Validado<T> = { ok: true; data: T } | { ok: false; errores: Errores }

/** Valida con zod y devuelve el primer mensaje por campo. */
export function validar<S extends z.ZodType>(
  schema: S,
  entrada: FormData | Record<string, unknown>,
): Validado<z.output<S>> {
  const r = schema.safeParse(aObjeto(entrada))
  if (r.success) return { ok: true, data: r.data }
  const errores: Errores = {}
  for (const issue of r.error.issues) {
    const campo = issue.path.length > 0 ? String(issue.path[0]) : '_form'
    errores[campo] ??= issue.message
  }
  return { ok: false, errores }
}
