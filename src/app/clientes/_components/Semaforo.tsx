import type { EstatusCargo } from '@/lib/queries/portal'

const COLOR: Record<EstatusCargo, string> = {
  pagado: 'bg-green-600',
  pendiente: 'bg-amber-400',
  parcial: 'bg-amber-400',
  vencido: 'bg-red-600',
}

const TEXTO: Record<EstatusCargo, string> = {
  pagado: 'text-green-800',
  pendiente: 'text-amber-800',
  parcial: 'text-amber-800',
  vencido: 'text-red-700',
}

/** Punto de color + etiqueta del estatus (el color nunca va solo). */
export function Semaforo({ estatus, etiqueta }: { estatus: EstatusCargo; etiqueta: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-semibold ${TEXTO[estatus]}`}>
      <span aria-hidden="true" className={`inline-block h-3 w-3 shrink-0 rounded-full ${COLOR[estatus]}`} />
      {etiqueta}
    </span>
  )
}
