import { mkdir, readFile as leer, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { ArchivoNoEncontrado, validarRuta, type Archivo } from './ruta'

function raiz(): string {
  return resolve(/*turbopackIgnore: true*/ process.env.STORAGE_LOCAL_ROOT ?? join(process.cwd(), 'storage'))
}

function rutaAbsoluta(path: string): string {
  const base = raiz()
  const abs = resolve(/*turbopackIgnore: true*/ base, validarRuta(path))
  if (!abs.startsWith(base + sep)) throw new Error(`Ruta inválida: ${JSON.stringify(path)}`)
  return abs
}

export async function putFile(path: string, data: Buffer, contentType: string): Promise<void> {
  const abs = rutaAbsoluta(path)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, data)
  await writeFile(`${abs}.meta.json`, JSON.stringify({ contentType }))
}

export async function getFileUrl(path: string): Promise<string> {
  return `/api/archivos/${validarRuta(path).split('/').map(encodeURIComponent).join('/')}`
}

export async function readFile(path: string): Promise<Archivo> {
  const abs = rutaAbsoluta(path)
  try {
    const data = await leer(abs)
    const meta = JSON.parse(await leer(`${abs}.meta.json`, 'utf8').catch(() => '{}'))
    return { data, contentType: meta.contentType ?? 'application/octet-stream' }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new ArchivoNoEncontrado(path)
    throw err
  }
}
