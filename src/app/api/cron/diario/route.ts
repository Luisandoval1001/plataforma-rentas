import { timingSafeEqual } from 'node:crypto'
import { ejecutarDiario } from '@/lib/jobs/diario'

function autorizado(req: Request, secreto: string): boolean {
  const recibido = Buffer.from(req.headers.get('authorization') ?? '')
  const esperado = Buffer.from(`Bearer ${secreto}`)
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado)
}

async function manejar(req: Request): Promise<Response> {
  const secreto = process.env.CRON_SECRET
  if (!secreto) return Response.json({ error: 'CRON_SECRET no configurado' }, { status: 500 })
  if (!autorizado(req, secreto)) return Response.json({ error: 'No autorizado' }, { status: 401 })
  try {
    return Response.json(await ejecutarDiario(new Date()))
  } catch (err) {
    console.error('Falló la tarea diaria', err)
    return Response.json({ error: 'Error al ejecutar la tarea diaria' }, { status: 500 })
  }
}

export const GET = manejar
export const POST = manejar
