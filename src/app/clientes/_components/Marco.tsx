import { Suspense, type ReactNode } from 'react'

/** Contenido dinámico (sesión + BD) detrás de Suspense, como pide cacheComponents. */
export function Pagina({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p aria-busy="true" className="text-gray-400">…</p>}>{children}</Suspense>
}

export function Titulo({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{children}</h1>
      {sub && <p className="text-gray-600">{sub}</p>}
    </div>
  )
}

/** Bloque por propietario: el nombre sólo se muestra cuando el usuario tiene más de uno. */
export function Grupo({ nombre, mostrar, children }: { nombre: string; mostrar: boolean; children: ReactNode }) {
  if (!mostrar) return <div className="space-y-4">{children}</div>
  return (
    <section aria-label={nombre} className="space-y-4">
      <h2 className="border-b border-gray-200 pb-1 text-xl font-semibold">{nombre}</h2>
      {children}
    </section>
  )
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-gray-300 bg-white p-6 text-center text-gray-600">{children}</p>
}

export function Tarjeta({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <li data-testid={testId} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      {children}
    </li>
  )
}

/** Pares etiqueta/valor en dos columnas (una en teléfono). */
export function Datos({ filas }: { filas: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
      {filas.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-gray-100 py-1 last:border-0">
          <dt className="text-sm text-gray-500">{k}</dt>
          <dd className="text-right font-medium tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export const enlace = 'text-blue-700 underline underline-offset-2'
