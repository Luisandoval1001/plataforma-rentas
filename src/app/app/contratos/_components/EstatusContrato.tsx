import { fecha } from '@/lib/formato'

const ESTILOS: Record<string, string> = {
  vigente: 'bg-green-100 text-green-800',
  por_vencer: 'bg-amber-100 text-amber-900',
  vencido: 'bg-red-100 text-red-800',
  pendiente_firma: 'bg-blue-100 text-blue-900',
  terminado: 'bg-gray-200 text-gray-700',
}

const TEXTO: Record<string, string> = {
  vigente: 'vigente',
  por_vencer: 'por vencer',
  vencido: 'vencido',
  pendiente_firma: 'pendiente de firma',
  terminado: 'terminado',
}

/** Insignia del estatus calculado (v_contratos.estatus_calc). */
export function EstatusContrato({ estatus, desde }: { estatus: string; desde?: Date | string | null }) {
  const texto = TEXTO[estatus] ?? estatus
  return (
    <span data-testid="estatus" className={`inline-block rounded-full px-2 py-0.5 text-sm font-medium ${ESTILOS[estatus] ?? ''}`}>
      {estatus === 'pendiente_firma' && desde ? `${texto} desde ${fecha(desde)}` : texto}
    </span>
  )
}
