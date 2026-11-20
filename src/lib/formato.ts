/** dd/mm/yyyy. Las columnas `date` llegan de postgres.js como Date a medianoche UTC (o como 'yyyy-mm-dd'). */
export function fecha(v: Date | string | null | undefined): string {
  if (v == null) return ''
  if (typeof v === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
    return m ? `${m[3]}/${m[2]}/${m[1]}` : v
  }
  const dd = String(v.getUTCDate()).padStart(2, '0')
  const mm = String(v.getUTCMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${v.getUTCFullYear()}`
}

const PESOS = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** $#,##0.00 (MXN). `numeric` llega como string. */
export function dinero(v: number | string | null | undefined): string {
  if (v == null || v === '') return ''
  const n = Number(v)
  if (!Number.isFinite(n)) return String(v)
  return `${n < 0 ? '-' : ''}$${PESOS.format(Math.abs(n))}`
}

/** 15 → "15%", 12.5 → "12.5%". */
export function porcentaje(v: number | string | null | undefined): string {
  if (v == null || v === '') return ''
  return `${Number(v)}%`
}

/** Periodo (primer día del mes) → "mm/yyyy". */
export function mes(v: Date | string | null | undefined): string {
  return fecha(v).slice(3)
}

/** Periodo → "yyyy-mm" (valor de <input type="month"> y del filtro `?periodo=`). */
export function mesIso(v: Date | string): string {
  const [mm, yyyy] = mes(v).split('/')
  return `${yyyy}-${mm}`
}

/** Zona horaria del negocio: fechas "de hoy" en la app y en la sesión de BD (withSession). */
export const ZONA_HORARIA = 'America/Mexico_City'

const DIA_LOCAL = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_HORARIA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** Hoy en ZONA_HORARIA (no el reloj del proceso), yyyy-mm-dd: valor por defecto de <input type="date">. */
export function hoyIso(ahora: Date = new Date()): string {
  return DIA_LOCAL.format(ahora)
}

/** Mes en curso en ZONA_HORARIA, yyyy-mm. */
export function mesActualIso(ahora: Date = new Date()): string {
  return hoyIso(ahora).slice(0, 7)
}

/** Mes anterior al mes en curso en ZONA_HORARIA, yyyy-mm: el último mes que ya se puede liquidar. */
export function mesAnteriorIso(ahora: Date = new Date()): string {
  const [y, m] = mesActualIso(ahora).split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}
