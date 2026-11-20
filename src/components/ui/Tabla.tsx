import type { ReactNode } from 'react'

/** Tabla simple con desplazamiento horizontal en pantallas angostas. */
export function Tabla({ columnas, children, vacio }: { columnas: string[]; children: ReactNode; vacio?: string }) {
  const filas = Array.isArray(children) ? children.length : children ? 1 : 0
  return (
    <div className="overflow-x-auto rounded-md border border-gray-200">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            {columnas.map((c) => (
              <th key={c} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-semibold text-gray-700">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {filas === 0 ? (
            <tr>
              <td colSpan={columnas.length} className="px-3 py-4 text-center text-gray-500">
                {vacio ?? 'Sin registros'}
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  )
}

export function Celda({ children, className = '' }: { children?: ReactNode; className?: string }) {
  return <td className={`whitespace-nowrap px-3 py-2 ${className}`}>{children}</td>
}
