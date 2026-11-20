import { proveedorAuth } from '@/lib/auth/proveedor'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { Suspense } from 'react'
import { getSql } from '@/lib/db'
import { esDemo } from '@/lib/demo'
import { entrarComo } from './actions'

type UsuarioDev = { id: string; email: string; nombre: string; rol: 'admin' | 'equipo' | 'propietario' }

const ROLES: Record<UsuarioDev['rol'], { etiqueta: string; descripcion: string }> = {
  admin: { etiqueta: 'Administrador', descripcion: 'Ve todo y cierra las liquidaciones del mes' },
  equipo: { etiqueta: 'Equipo', descripcion: 'Registra pagos, gastos y contratos' },
  propietario: { etiqueta: 'Propietario (cliente)', descripcion: 'Portal de consulta: sus rentas y estados de cuenta' },
}

async function Lista() {
  await connection()
  if (proveedorAuth() !== 'local') notFound()
  const usuarios = await getSql()<UsuarioDev[]>`select id, email, nombre, rol from app.usuarios_dev_login()`
  if (usuarios.length === 0) return <p>No hay usuarios activos.</p>
  return (
    <>
      <h1 className="text-2xl font-semibold">
        {esDemo() ? '¿Con qué usuario quieres entrar?' : 'Entrar como (desarrollo)'}
      </h1>
      {esDemo() && (
        <p className="text-sm text-gray-600">
          Demostración con datos ficticios. Puedes cambiar de usuario cuando quieras desde la franja
          superior.
        </p>
      )}
      <ul className="space-y-2">
        {usuarios.map((u) => (
          <li key={u.id}>
            <form action={entrarComo}>
              <input type="hidden" name="usuarioId" value={u.id} />
              <button
                type="submit"
                aria-label={u.email}
                className="w-full rounded border bg-white px-4 py-3 text-left hover:bg-gray-50"
              >
                <span className="block font-medium">{u.nombre}</span>
                <span className="block text-sm text-gray-600">
                  {ROLES[u.rol].etiqueta} · {ROLES[u.rol].descripcion}
                </span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </>
  )
}

export default function DevLoginPage() {
  return (
    <main className="mx-auto mt-16 w-full max-w-md space-y-6 p-6 sm:mt-24">
      <Suspense>
        <Lista />
      </Suspense>
    </main>
  )
}
