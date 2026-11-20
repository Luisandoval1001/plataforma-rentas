/** Valida una ruta relativa de archivo: sin `..`, sin `/` inicial, sin `\`, sin segmentos vacíos. */
export function validarRuta(path: string): string {
  const segmentos = path.split('/')
  const invalida =
    path.length === 0 ||
    path.includes('\\') ||
    path.includes('\0') ||
    segmentos.some((s) => s === '' || s === '.' || s === '..')
  if (invalida) throw new Error(`Ruta inválida: ${JSON.stringify(path)}`)
  return path
}

export class ArchivoNoEncontrado extends Error {
  name = 'ArchivoNoEncontrado'
  constructor(path: string) {
    super(`Archivo no encontrado: ${path}`)
  }
}

export type Archivo = { data: Buffer; contentType: string }
