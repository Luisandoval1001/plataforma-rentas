import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Email } from './tipos'

/** Escribe el correo como JSON en tmp/emails (o EMAIL_LOCAL_DIR). */
export async function sendEmail(msg: Email): Promise<void> {
  const dir = process.env.EMAIL_LOCAL_DIR ?? join(/*turbopackIgnore: true*/ process.cwd(), 'tmp', 'emails')
  await mkdir(dir, { recursive: true })
  const nombre = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}.json`
  await writeFile(join(/*turbopackIgnore: true*/ dir, nombre), JSON.stringify({ ...msg, fecha: new Date().toISOString() }, null, 2))
}
