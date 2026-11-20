import { cache } from 'react'
import { requireRol } from '@/lib/auth/session'
import { idiomaValido, t, type Clave, type Idioma } from '@/lib/i18n'
import { portalPropietarios } from '@/lib/queries/portal'

/**
 * Sesión de propietario (si no, 403/login), sus propietarios y el idioma del portal: el del primer
 * propietario. Memoizado por petición: lo comparten el layout y la página.
 */
export const contextoPortal = cache(async () => {
  const session = await requireRol('propietario')
  const propietarios = await portalPropietarios(session)
  const idioma: Idioma = idiomaValido(propietarios[0]?.idioma)
  const tr = (clave: Clave, vars?: Record<string, string | number>) => t(idioma, clave, vars)
  return { session, propietarios, idioma, t: tr }
})

/** Agrupa renglones por propietario (en el orden de `propietarios`), omitiendo grupos vacíos. */
export function porPropietario<T extends { propietario_id: string }>(
  propietarios: { id: string; nombre: string }[],
  filas: T[],
) {
  return propietarios
    .map((p) => ({ propietario: p, filas: filas.filter((f) => f.propietario_id === p.id) }))
    .filter((g) => g.filas.length > 0)
}
