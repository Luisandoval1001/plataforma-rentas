import { getSession } from '@/lib/auth/session'
import { ArchivoNoEncontrado, readFile } from '@/lib/storage'
import { puedeLeerArchivo } from '@/lib/storage/acceso'

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const session = await getSession()
  if (!session) return new Response('No autenticado', { status: 401 })
  const path = (await ctx.params).path.join('/')
  if (!puedeLeerArchivo(session, path)) return new Response('Prohibido', { status: 403 })
  try {
    const { data, contentType } = await readFile(path)
    return new Response(new Uint8Array(data), {
      headers: {
        'content-type': contentType,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': 'sandbox',
      },
    })
  } catch (err) {
    if (err instanceof ArchivoNoEncontrado) return new Response('No encontrado', { status: 404 })
    if (err instanceof Error && err.message.startsWith('Ruta inválida')) {
      return new Response('Ruta inválida', { status: 400 })
    }
    throw err
  }
}
