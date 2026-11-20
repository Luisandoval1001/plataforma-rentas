import Link from 'next/link'
import { Suspense, type ReactNode } from 'react'
import { cerrarSesion } from '@/lib/auth/acciones'
import { t } from '@/lib/i18n'
import { contextoPortal } from './_lib/contexto'

const SECCIONES = [
  ['nav.resumen', '/clientes'],
  ['nav.estadosCuenta', '/clientes/estados-de-cuenta'],
  ['nav.contratos', '/clientes/contratos'],
  ['nav.documentos', '/clientes/documentos'],
] as const

async function Encabezado() {
  const { t: tr } = await contextoPortal()
  return (
    <>
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 pt-3">
        <span className="font-semibold text-blue-800">{tr('marca')}</span>
        <form action={cerrarSesion}>
          <button type="submit" className="min-h-11 rounded-md px-3 text-sm text-gray-700 hover:bg-gray-100">
            {tr('sesion.cerrar')}
          </button>
        </form>
      </div>
      <nav aria-label={tr('nav.secciones')} className="mx-auto max-w-3xl overflow-x-auto px-2">
        <ul className="flex gap-1 whitespace-nowrap py-2">
          {SECCIONES.map(([clave, href]) => (
            <li key={href}>
              <Link href={href} className="block rounded-md px-3 py-2 text-base hover:bg-gray-100">
                {tr(clave)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  )
}

async function Pie() {
  const { t: tr } = await contextoPortal()
  return <p className="mx-auto max-w-3xl px-4 pb-6 text-xs text-gray-500">{tr('formato.fecha')}</p>
}

export default function ClientesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-gray-50 text-gray-900">
      <header className="border-b border-gray-200 bg-white">
        <Suspense
          fallback={<div className="mx-auto max-w-3xl px-4 py-3 font-semibold text-blue-800">{t('es', 'marca')}</div>}
        >
          <Encabezado />
        </Suspense>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-6">{children}</main>
      <footer>
        <Suspense>
          <Pie />
        </Suspense>
      </footer>
    </div>
  )
}
