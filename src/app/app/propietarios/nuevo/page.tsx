import { crearPropietario } from '@/app/app/_actions/propietarios'
import { Encabezado, Pagina } from '@/app/app/_components/Pagina'
import { Formulario } from '@/components/ui/Formulario'
import { requireRol } from '@/lib/auth/session'
import { CamposPropietario } from '../_components/CamposPropietario'

async function Contenido() {
  await requireRol('admin')
  return (
    <>
      <Encabezado titulo="Nuevo propietario" />
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <Formulario accion={crearPropietario} redirigirA="/app/propietarios/:id">
          <CamposPropietario />
        </Formulario>
      </div>
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
