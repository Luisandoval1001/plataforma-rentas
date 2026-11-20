import * as local from './local'
import * as supabase from './supabase'
import type { Archivo } from './ruta'

export { ArchivoNoEncontrado, type Archivo } from './ruta'

function proveedor() {
  return process.env.STORAGE_PROVIDER === 'supabase' ? supabase : local
}

export function putFile(path: string, data: Buffer, contentType: string): Promise<void> {
  return proveedor().putFile(path, data, contentType)
}

export function getFileUrl(path: string): Promise<string> {
  return proveedor().getFileUrl(path)
}

export function readFile(path: string): Promise<Archivo> {
  return proveedor().readFile(path)
}
