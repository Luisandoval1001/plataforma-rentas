import { createClient } from '@supabase/supabase-js'
import { ArchivoNoEncontrado, validarRuta, type Archivo } from './ruta'

const BUCKET = 'archivos'
const URL_FIRMADA_SEGUNDOS = 3600

function bucket() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false } }).storage.from(BUCKET)
}

export async function putFile(path: string, data: Buffer, contentType: string): Promise<void> {
  const { error } = await bucket().upload(validarRuta(path), data, { contentType, upsert: true })
  if (error) throw error
}

export async function getFileUrl(path: string): Promise<string> {
  const { data, error } = await bucket().createSignedUrl(validarRuta(path), URL_FIRMADA_SEGUNDOS)
  if (error) throw error
  return data.signedUrl
}

export async function readFile(path: string): Promise<Archivo> {
  const { data, error } = await bucket().download(validarRuta(path))
  if (error || !data) throw new ArchivoNoEncontrado(path)
  return {
    data: Buffer.from(await data.arrayBuffer()),
    contentType: data.type || 'application/octet-stream',
  }
}
