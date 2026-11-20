import type { Session } from '@/lib/auth/types'

/** admin/equipo leen todo; propietario sólo `propietarios/<id>/…` de sus propietarioIds. */
export function puedeLeerArchivo(session: Session, path: string): boolean {
  if (session.rol !== 'propietario') return true
  const segmentos = path.split('/')
  return (
    segmentos.length >= 3 &&
    segmentos[0] === 'propietarios' &&
    session.propietarioIds.includes(segmentos[1]) &&
    !segmentos.includes('..')
  )
}
