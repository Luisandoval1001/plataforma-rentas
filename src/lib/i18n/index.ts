import { en } from './en'
import { es, type Clave } from './es'

export type Idioma = 'es' | 'en'
export type { Clave }

const TEXTOS: Record<Idioma, Record<Clave, string>> = { es, en }

/** Texto de `clave` en `idioma`; `{nombre}` se sustituye con `vars.nombre`. */
export function t(idioma: Idioma, clave: Clave, vars?: Record<string, string | number>): string {
  const texto = TEXTOS[idioma][clave]
  if (!vars) return texto
  return texto.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

/** Cualquier valor → idioma soportado ('es' por omisión). */
export function idiomaValido(v: unknown): Idioma {
  return v === 'en' ? 'en' : 'es'
}

/** 'YYYY-MM' o 'YYYY-MM-DD' (o Date a medianoche UTC) → "Octubre 2026" / "October 2026". */
export function nombreMes(idioma: Idioma, periodo: string | Date): string {
  const iso = typeof periodo === 'string' ? periodo : periodo.toISOString()
  return `${t(idioma, `mes.${Number(iso.slice(5, 7))}` as Clave)} ${iso.slice(0, 4)}`
}
