import { dinero, fecha } from '@/lib/formato'

export function escapar(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** Aviso al propietario de un pago registrado. `lugar` = "<inmueble> <unidad>" (varios separados por coma). */
export function correoAvisoPago(d: { lugar: string; monto: number; fecha: string; referencia: string }) {
  const filas: [string, string][] = [
    ['Monto', dinero(d.monto)],
    ['Fecha', fecha(d.fecha)],
    ['Referencia', d.referencia || 'Sin referencia'],
  ]
  return {
    subject: `Se registró un pago en ${d.lugar}`,
    html:
      `<p>Se registró un pago en <strong>${escapar(d.lugar)}</strong>.</p><ul>` +
      filas.map(([k, v]) => `<li>${k}: ${escapar(v)}</li>`).join('') +
      '</ul><p>Casas y Terrenos DISA</p>',
  }
}

const MESES = {
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
} as const

/** 'YYYY-MM' → "marzo de 2026" / "March 2026". */
export function mesLargo(periodo: string, idioma: 'es' | 'en' = 'es'): string {
  const [yyyy, mm] = periodo.split('-')
  const m = MESES[idioma][Number(mm) - 1] ?? mm
  return idioma === 'en' ? `${m} ${yyyy}` : `${m} de ${yyyy}`
}

/** Aviso al propietario de que su estado de cuenta (liquidación cerrada) ya está en el portal. */
export function correoEstadoCuenta(d: { periodo: string; idioma: 'es' | 'en' }) {
  const mes = mesLargo(d.periodo, d.idioma)
  if (d.idioma === 'en') {
    return {
      subject: `Your account statement for ${mes} is ready`,
      html: `<p>Your account statement for <strong>${escapar(mes)}</strong> is ready. You can find it in the owner portal.</p><p>Casas y Terrenos DISA</p>`,
    }
  }
  return {
    subject: `Tu estado de cuenta de ${mes} está listo`,
    html: `<p>Tu estado de cuenta de <strong>${escapar(mes)}</strong> está listo. Puedes consultarlo en el portal de propietarios.</p><p>Casas y Terrenos DISA</p>`,
  }
}

/** Aviso al propietario de que un contrato vence pronto. `lugar` = "<inmueble> <unidad>". */
export function correoContratoPorVencer(d: {
  lugar: string
  inquilino: string
  fechaFin: string
  renta: number | string
  idioma: 'es' | 'en'
}) {
  const fin = fecha(d.fechaFin)
  const en = d.idioma === 'en'
  const filas: [string, string][] = en
    ? [['Tenant', d.inquilino], ['End date', fin], ['Monthly rent', dinero(d.renta)]]
    : [['Inquilino', d.inquilino], ['Fecha de vencimiento', fin], ['Renta mensual', dinero(d.renta)]]
  const intro = en
    ? `The lease for <strong>${escapar(d.lugar)}</strong> ends soon.`
    : `El contrato de <strong>${escapar(d.lugar)}</strong> vence pronto.`
  return {
    subject: en ? `The lease for ${d.lugar} ends on ${fin}` : `El contrato de ${d.lugar} vence el ${fin}`,
    html: `<p>${intro}</p><ul>` + filas.map(([k, v]) => `<li>${k}: ${escapar(v)}</li>`).join('') + '</ul><p>Casas y Terrenos DISA</p>',
  }
}
