import Link from 'next/link'
import { Encabezado, Pagina } from '@/app/app/_components/Pagina'
import { BotonEnlace } from '@/components/ui/Boton'
import { Celda, Tabla } from '@/components/ui/Tabla'
import { requireRol } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import { porcentaje } from '@/lib/formato'
import { listarPropietarios, MODELO_TEXTO } from '@/lib/queries/propietarios'

async function Contenido() {
  const session = await requireRol('admin', 'equipo')
  const propietarios = await withSession(session, listarPropietarios)
  return (
    <>
      <Encabezado titulo="Propietarios">
        {session.rol === 'admin' && <BotonEnlace href="/app/propietarios/nuevo">Nuevo propietario</BotonEnlace>}
      </Encabezado>
      <Tabla columnas={['Nombre', 'Modelo', 'Comisión', 'Inmuebles']} vacio="Aún no hay propietarios">
        {propietarios.map((p) => (
          <tr key={p.id}>
            <Celda>
              <Link href={`/app/propietarios/${p.id}`} className="text-blue-700 underline">
                {p.nombre}
              </Link>
              {!p.activo && <span className="ml-2 text-gray-500">(inactivo)</span>}
            </Celda>
            <Celda>{MODELO_TEXTO[p.modelo]}</Celda>
            <Celda>{porcentaje(p.comision_pct)}</Celda>
            <Celda>{p.inmuebles}</Celda>
          </tr>
        ))}
      </Tabla>
    </>
  )
}

export default function Page() {
  return (
    <Pagina>
      <Contenido />
    </Pagina>
  )
}
