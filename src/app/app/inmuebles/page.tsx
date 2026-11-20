import Link from 'next/link'
import { Encabezado, Pagina } from '@/app/app/_components/Pagina'
import { BotonEnlace } from '@/components/ui/Boton'
import { Celda, Tabla } from '@/components/ui/Tabla'
import { requireRol } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import { listarInmuebles } from '@/lib/queries/inmuebles'
import { textoTipo } from './_components/CamposInmueble'

async function Contenido() {
  const session = await requireRol('admin', 'equipo')
  const inmuebles = await withSession(session, listarInmuebles)
  return (
    <>
      <Encabezado titulo="Inmuebles">
        <BotonEnlace href="/app/inmuebles/nuevo">Nuevo inmueble</BotonEnlace>
      </Encabezado>
      <Tabla columnas={['Inmueble', 'Tipo', 'Propietario', 'Cobrador', 'Unidades']} vacio="Aún no hay inmuebles">
        {inmuebles.map((i) => (
          <tr key={i.id}>
            <Celda>
              <Link href={`/app/inmuebles/${i.id}`} className="text-blue-700 underline">
                {i.nombre}
              </Link>
            </Celda>
            <Celda>{textoTipo(i.tipo)}</Celda>
            <Celda>{i.propietario_nombre}</Celda>
            <Celda>{i.cobrador_nombre ?? '—'}</Celda>
            <Celda>{i.unidades}</Celda>
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
