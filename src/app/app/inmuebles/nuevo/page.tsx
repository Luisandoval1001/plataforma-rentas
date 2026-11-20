import { crearInmueble } from '@/app/app/_actions/inmuebles'
import { Encabezado, Pagina } from '@/app/app/_components/Pagina'
import { CampoSelect } from '@/components/ui/Campo'
import { Formulario } from '@/components/ui/Formulario'
import { requireRol } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import { cobradores } from '@/lib/queries/inmuebles'
import { opcionesPropietarios } from '@/lib/queries/propietarios'
import { CamposInmueble } from '../_components/CamposInmueble'

async function Contenido({ searchParams }: { searchParams: Promise<{ propietario?: string }> }) {
  const session = await requireRol('admin', 'equipo')
  const { propietario } = await searchParams
  const [propietarios, usuarios] = await withSession(session, (sql) =>
    Promise.all([opcionesPropietarios(sql), cobradores(sql)]),
  )
  return (
    <>
      <Encabezado titulo="Nuevo inmueble" />
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <Formulario accion={crearInmueble} redirigirA="/app/inmuebles/:id">
          <CampoSelect
            etiqueta="Propietario"
            name="propietario_id"
            defaultValue={propietario ?? ''}
            vacio="Selecciona…"
            opciones={propietarios.map((p) => ({ valor: p.id, texto: p.nombre }))}
            required
          />
          <CamposInmueble cobradores={usuarios.map((u) => ({ valor: u.id, texto: u.nombre }))} />
        </Formulario>
      </div>
    </>
  )
}

export default function Page({ searchParams }: { searchParams: Promise<{ propietario?: string }> }) {
  return (
    <Pagina>
      <Contenido searchParams={searchParams} />
    </Pagina>
  )
}
