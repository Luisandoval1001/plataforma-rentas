'use client'

import { useState, useTransition } from 'react'
import { actualizarNotaCargo } from '@/app/app/_actions/cobranza'

/** Nota del cargo editable en línea: se guarda con Enter o al salir del campo si cambió. */
export function NotaCargo({ cargoId, notas }: { cargoId: string; notas: string | null }) {
  const [guardada, setGuardada] = useState(notas ?? '')
  const [estado, setEstado] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const [pendiente, iniciar] = useTransition()

  function guardar(valor: string) {
    if (valor.trim() === guardada.trim()) return
    iniciar(async () => {
      const r = await actualizarNotaCargo(cargoId, valor)
      if (r.ok) {
        setGuardada(valor)
        setEstado({ tipo: 'ok', texto: 'Guardado' })
      } else {
        setEstado({ tipo: 'error', texto: Object.values(r.errores)[0] ?? 'No se pudo guardar' })
      }
    })
  }

  return (
    <form
      className="min-w-48 space-y-1"
      onSubmit={(e) => {
        e.preventDefault()
        guardar(String(new FormData(e.currentTarget).get('notas') ?? ''))
      }}
    >
      <label className="sr-only" htmlFor={`nota-${cargoId}`}>
        Notas
      </label>
      <input
        id={`nota-${cargoId}`}
        name="notas"
        defaultValue={notas ?? ''}
        maxLength={500}
        disabled={pendiente}
        onBlur={(e) => guardar(e.currentTarget.value)}
        onChange={() => setEstado(null)}
        className="block w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
      />
      {estado && (
        <p role={estado.tipo === 'error' ? 'alert' : 'status'} className={estado.tipo === 'error' ? 'text-xs text-red-700' : 'text-xs text-green-700'}>
          {estado.texto}
        </p>
      )}
    </form>
  )
}
