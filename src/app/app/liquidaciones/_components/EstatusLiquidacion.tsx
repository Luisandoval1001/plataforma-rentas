const ESTILOS: Record<string, string> = {
  'sin preparar': 'bg-gray-100 text-gray-700',
  borrador: 'bg-amber-100 text-amber-900',
  cerrada: 'bg-blue-100 text-blue-900',
  pagada: 'bg-green-100 text-green-800',
}

export function EstatusLiquidacion({ estatus }: { estatus: string | null }) {
  const e = estatus ?? 'sin preparar'
  return (
    <span data-testid="estatus" className={`inline-block rounded-full px-2 py-0.5 text-sm font-medium ${ESTILOS[e] ?? ''}`}>
      {e}
    </span>
  )
}
