import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getFileUrl, putFile, readFile } from '@/lib/storage'

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'storage-'))
  process.env.STORAGE_LOCAL_ROOT = root
  process.env.STORAGE_PROVIDER = 'local'
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  delete process.env.STORAGE_LOCAL_ROOT
})

describe('storage local', () => {
  it('putFile escribe bajo la raíz y readFile devuelve datos y contentType', async () => {
    await putFile('propietarios/x/a.txt', Buffer.from('hola'), 'text/plain')
    expect(readFileSync(join(root, 'propietarios/x/a.txt'), 'utf8')).toBe('hola')
    const f = await readFile('propietarios/x/a.txt')
    expect(f.data.toString('utf8')).toBe('hola')
    expect(f.contentType).toBe('text/plain')
  })

  it('getFileUrl apunta a /api/archivos', async () => {
    expect(await getFileUrl('propietarios/x/a.txt')).toBe('/api/archivos/propietarios/x/a.txt')
    expect(await getFileUrl('propietarios/x/mi archivo.pdf')).toBe(
      '/api/archivos/propietarios/x/mi%20archivo.pdf',
    )
  })

  it('rechaza rutas con .., absolutas o vacías', async () => {
    for (const p of ['../fuera.txt', 'propietarios/../../x', '/etc/passwd', '', 'a//b', 'a\\..\\b']) {
      await expect(putFile(p, Buffer.from('x'), 'text/plain')).rejects.toThrow(/Ruta inválida/)
      await expect(readFile(p)).rejects.toThrow(/Ruta inválida/)
    }
  })

  it('readFile de un archivo inexistente lanza ArchivoNoEncontrado', async () => {
    await expect(readFile('propietarios/x/nada.txt')).rejects.toMatchObject({ name: 'ArchivoNoEncontrado' })
  })
})
