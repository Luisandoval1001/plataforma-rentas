import type { Validado } from './comun'

/**
 * Tope por archivo: Vercel rechaza peticiones de más de ~4.5 MB a funciones (server actions incluidas),
 * así que todo archivo que pasa por el servidor se limita a 4 MB (next.config: bodySizeLimit 4.5mb).
 * Subida directa a Storage para archivos grandes: fase 2.
 */
export const ARCHIVO_MAX_BYTES = 4 * 1024 * 1024
export const MENSAJE_TAMANO = 'El archivo debe pesar menos de 4 MB; reduce la resolución o comprime el PDF'

const muyGrande = (v: File) => v.size > ARCHIVO_MAX_BYTES

/** PDF de un campo de FormData: valida firma `%PDF` y tamaño. Vacío → null (o error si es requerido). */
export async function leerPdf(
  entrada: FormData,
  campo: string,
  requerido: boolean,
): Promise<Validado<Buffer | null>> {
  const v = entrada.get(campo)
  if (!(v instanceof File) || v.size === 0) {
    return requerido ? { ok: false, errores: { [campo]: 'Sube el PDF' } } : { ok: true, data: null }
  }
  if (muyGrande(v)) return { ok: false, errores: { [campo]: MENSAJE_TAMANO } }
  const data = Buffer.from(await v.arrayBuffer())
  if (data.subarray(0, 5).toString('latin1') !== '%PDF-') {
    return { ok: false, errores: { [campo]: 'El archivo no es un PDF' } }
  }
  return { ok: true, data }
}

export type Comprobante = { data: Buffer; ext: string; contentType: string }

/** Tipo por firma del archivo (no por el nombre ni el content-type que manda el navegador). */
function tipoComprobante(b: Buffer): Omit<Comprobante, 'data'> | null {
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return { ext: 'pdf', contentType: 'application/pdf' }
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', contentType: 'image/png' }
  }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', contentType: 'image/jpeg' }
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { ext: 'webp', contentType: 'image/webp' }
  }
  return null
}

/** Comprobante de pago opcional: imagen (JPG, PNG, WEBP) o PDF de hasta 4 MB. Vacío → null. */
export async function leerComprobante(entrada: FormData, campo: string): Promise<Validado<Comprobante | null>> {
  const v = entrada.get(campo)
  if (!(v instanceof File) || v.size === 0) return { ok: true, data: null }
  if (muyGrande(v)) return { ok: false, errores: { [campo]: MENSAJE_TAMANO } }
  const data = Buffer.from(await v.arrayBuffer())
  const tipo = tipoComprobante(data)
  if (!tipo) return { ok: false, errores: { [campo]: 'El comprobante debe ser imagen (JPG, PNG, WEBP) o PDF' } }
  return { ok: true, data: { data, ...tipo } }
}

/** XML de factura (CFDI): empieza con `<?xml` o `<cfdi:Comprobante` (se toleran BOM y espacios). */
export async function leerXml(entrada: FormData, campo: string): Promise<Validado<Comprobante | null>> {
  const v = entrada.get(campo)
  if (!(v instanceof File) || v.size === 0) return { ok: true, data: null }
  if (muyGrande(v)) return { ok: false, errores: { [campo]: MENSAJE_TAMANO } }
  const data = Buffer.from(await v.arrayBuffer())
  const inicio = data.subarray(0, 200).toString('utf8').replace(/^﻿/, '').trimStart()
  if (!inicio.startsWith('<?xml') && !inicio.startsWith('<cfdi:Comprobante')) {
    return { ok: false, errores: { [campo]: 'El archivo no es un XML' } }
  }
  return { ok: true, data: { data, ext: 'xml', contentType: 'application/xml' } }
}

/** Archivo obligatorio de un documento: imagen (JPG, PNG, WEBP) o PDF de hasta 4 MB. */
export async function leerArchivoDocumento(entrada: FormData, campo: string): Promise<Validado<Comprobante>> {
  const v = await leerComprobante(entrada, campo)
  if (!v.ok && v.errores[campo] === MENSAJE_TAMANO) return v
  if (!v.ok) return { ok: false, errores: { [campo]: 'El archivo debe ser PDF o imagen (JPG, PNG, WEBP)' } }
  if (!v.data) return { ok: false, errores: { [campo]: 'Sube el archivo' } }
  return { ok: true, data: v.data }
}
