/** Parser CSV mínimo (RFC 4180): comillas dobles, comas y saltos de línea dentro de campos, BOM y CRLF. */
export type Fila = { linea: number; valores: Record<string, string> }

export function parseCsv(texto: string): Fila[] {
  const t = texto.replace(/^﻿/, '')
  const registros: { linea: number; campos: string[] }[] = []
  let campos: string[] = []
  let campo = ''
  let enComillas = false
  let linea = 1
  let inicio = 1
  const cierraRegistro = () => {
    campos.push(campo)
    if (!(campos.length === 1 && campos[0].trim() === '')) registros.push({ linea: inicio, campos })
    campos = []
    campo = ''
  }
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (enComillas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++ }
      else if (c === '"') enComillas = false
      else { if (c === '\n') linea++; campo += c }
    } else if (c === '"' && campo === '') enComillas = true
    else if (c === ',') { campos.push(campo); campo = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      cierraRegistro()
      linea++
      inicio = linea
    } else campo += c
  }
  if (enComillas) throw new Error(`comillas sin cerrar (registro que inicia en la línea ${inicio})`)
  if (campo !== '' || campos.length > 0) cierraRegistro()

  const [encabezado, ...resto] = registros
  if (!encabezado) return []
  const cols = encabezado.campos.map((c) => c.trim())
  return resto.map(({ linea, campos }) => {
    if (campos.length !== cols.length) {
      throw new Error(`línea ${linea}: se esperaban ${cols.length} columnas y hay ${campos.length}`)
    }
    return { linea, valores: Object.fromEntries(cols.map((c, i) => [c, campos[i].trim()])) }
  })
}
