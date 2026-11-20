const ESTILOS: Record<string, string> = {
  pagado: 'bg-green-100 text-green-800',
  parcial: 'bg-amber-100 text-amber-900',
  pendiente: 'bg-blue-100 text-blue-900',
  vencido: 'bg-red-100 text-red-800',
}

/** Insignia del estatus calculado del cargo (v_cargos.estatus). */
export function EstatusCargo({ estatus }: { estatus: string }) {
  return (
    <span data-testid="estatus" className={`inline-block rounded-full px-2 py-0.5 text-sm font-medium ${ESTILOS[estatus] ?? ''}`}>
      {estatus}
    </span>
  )
}
