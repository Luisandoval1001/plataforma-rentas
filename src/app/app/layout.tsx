import Link from 'next/link'
import type { ReactNode } from 'react'

const SECCIONES = [
  ['Tablero', '/app'],
  ['Cobranza', '/app/cobranza'],
  ['Inmuebles', '/app/inmuebles'],
  ['Contratos', '/app/contratos'],
  ['Gastos', '/app/gastos'],
  ['Liquidaciones', '/app/liquidaciones'],
  ['Propietarios', '/app/propietarios'],
] as const

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 pt-3 text-sm font-semibold text-blue-800">DISA · Rentas</div>
        <nav aria-label="Secciones" className="mx-auto max-w-5xl overflow-x-auto px-2">
          <ul className="flex gap-1 whitespace-nowrap py-2">
            {SECCIONES.map(([texto, href]) => (
              <li key={href}>
                <Link href={href} className="block rounded-md px-3 py-2 text-base hover:bg-gray-100">
                  {texto}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-6">{children}</main>
    </div>
  )
}
