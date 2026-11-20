'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { cancelarPago } from '@/app/app/_actions/cobranza'
import { dinero, fecha } from '@/lib/formato'
import type { PagoAplicado } from '@/lib/queries/cobranza'

/** Pagos aplicados al cargo, con cancelación (pide el motivo). */
export function PagosCargo({ pagos }: { pagos: PagoAplicado[] }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pendiente, iniciar] = useTransition()
  if (pagos.length === 0) return <span className="text-gray-400">—</span>

  function cancelar(pagoId: string) {
    const motivo = window.prompt('Motivo de la cancelación')
    if (motivo === null) return
    iniciar(async () => {
      const r = await cancelarPago(pagoId, motivo)
      setError(r.ok ? null : (Object.values(r.errores)[0] ?? 'No se pudo cancelar'))
      if (r.ok) router.refresh()
    })
  }

  return (
    <details>
      <summary className="cursor-pointer text-blue-700">Pagos ({pagos.length})</summary>
      <ul className="mt-2 space-y-2">
        {pagos.map((p) => (
          <li key={p.id} className="space-y-1 rounded border border-gray-200 p-2">
            <div>
              {fecha(p.fecha)} · {dinero(p.monto_aplicado)}
              {p.monto !== p.monto_aplicado && <span className="text-gray-500"> de {dinero(p.monto)}</span>}
            </div>
            <div className="text-gray-600">
              {p.metodo ?? ''} {p.referencia && `· ${p.referencia}`}
            </div>
            {p.cancelado ? (
              <div className="text-red-700">Cancelado: {p.cancelado_motivo}</div>
            ) : (
              <button
                type="button"
                disabled={pendiente}
                onClick={() => cancelar(p.id)}
                className="min-h-9 rounded-md border border-red-300 px-3 text-red-700 hover:bg-red-50"
              >
                Cancelar pago
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-1 text-red-700">
          {error}
        </p>
      )}
    </details>
  )
}
