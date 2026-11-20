import type { ReactNode } from 'react'

const ESTILOS = {
  error: 'border-red-300 bg-red-50 text-red-800',
  exito: 'border-green-300 bg-green-50 text-green-800',
  info: 'border-blue-200 bg-blue-50 text-blue-900',
  advertencia: 'border-amber-300 bg-amber-50 text-amber-900',
} as const

export function Alerta({ tipo = 'info', children }: { tipo?: keyof typeof ESTILOS; children: ReactNode }) {
  return (
    <div role={tipo === 'error' || tipo === 'advertencia' ? 'alert' : 'status'} className={`rounded-md border px-3 py-2 ${ESTILOS[tipo]}`}>
      {children}
    </div>
  )
}
