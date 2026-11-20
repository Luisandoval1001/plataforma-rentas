import { createHmac, timingSafeEqual } from 'node:crypto'

export const SESION_COOKIE = 'sesion'
const MAX_AGE = 12 * 60 * 60

type CookieJar = { get(name: string): { value: string } | undefined }

function firmar(usuarioId: string): Buffer {
  const secret = process.env.SESSION_SECRET
  if (!secret) throw new Error('Falta SESSION_SECRET')
  return createHmac('sha256', secret).update(usuarioId).digest()
}

/** Cookie `sesion` = base64url(usuarioId) + '.' + base64url(HMAC-SHA256(usuarioId)). */
export function crearCookieLocal(usuarioId: string) {
  const value = `${Buffer.from(usuarioId).toString('base64url')}.${firmar(usuarioId).toString('base64url')}`
  return {
    name: SESION_COOKIE,
    value,
    options: {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: MAX_AGE,
    },
  }
}

/** usuarioId de la cookie si la firma es válida; si no, null. */
export function leerSesionLocal(cookies: CookieJar): string | null {
  const raw = cookies.get(SESION_COOKIE)?.value
  if (!raw) return null
  const partes = raw.split('.')
  if (partes.length !== 2) return null
  const usuarioId = Buffer.from(partes[0], 'base64url').toString('utf8')
  const recibida = Buffer.from(partes[1], 'base64url')
  const esperada = firmar(usuarioId)
  if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada)) return null
  return usuarioId
}
