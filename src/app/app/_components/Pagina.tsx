import { Suspense, type ReactNode } from 'react'

/** Contenido dinámico (sesión + BD) detrás de Suspense, como pide cacheComponents. */
export function Pagina({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p className="text-gray-500">Cargando…</p>}>{children}</Suspense>
}

export function Encabezado({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">{titulo}</h1>
      {children}
    </div>
  )
}

export function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section aria-label={titulo} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-lg font-semibold">{titulo}</h2>
      {children}
    </section>
  )
}

/** Lista de datos etiqueta/valor (fichas). */
export function Datos({ filas }: { filas: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {filas.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-gray-100 py-1 sm:block sm:border-0">
          <dt className="text-sm text-gray-500">{k}</dt>
          <dd className="text-right font-medium sm:text-left">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  )
}
