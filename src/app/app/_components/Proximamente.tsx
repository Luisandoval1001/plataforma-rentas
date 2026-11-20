import { requireRol } from '@/lib/auth/session'
import { Encabezado, Pagina } from './Pagina'

async function Contenido({ titulo }: { titulo: string }) {
  await requireRol('admin', 'equipo')
  return (
    <>
      <Encabezado titulo={titulo} />
      <p className="text-gray-600">Próximamente.</p>
    </>
  )
}

export function Proximamente({ titulo }: { titulo: string }) {
  return (
    <Pagina>
      <Contenido titulo={titulo} />
    </Pagina>
  )
}
