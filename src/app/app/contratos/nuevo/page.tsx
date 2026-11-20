import { Encabezado, Pagina } from '@/app/app/_components/Pagina'
import { requireRol } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import { opcionesUnidades } from '@/lib/queries/contratos'
import { opcionesInquilinos } from '@/lib/queries/inquilinos'
import { opcionesPropietarios } from '@/lib/queries/propietarios'
import { FormularioContrato } from '../_components/FormularioContrato'

async function Contenido({ searchParams }: { searchParams: Promise<{ unidad?: string }> }) {
  const session = await requireRol('admin', 'equipo')
  const { unidad } = await searchParams
  const [propietarios, { inmuebles, unidades }, inquilinos] = await withSession(session, (sql) =>
    Promise.all([opcionesPropietarios(sql), opcionesUnidades(sql), opcionesInquilinos(sql)]),
  )
  return (
    <>
      <Encabezado titulo="Nuevo contrato" />
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <FormularioContrato
          propietarios={[...propietarios]}
          inmuebles={inmuebles}
          unidades={unidades}
          inquilinos={[...inquilinos]}
          unidadInicial={unidad}
        />
      </div>
    </>
  )
}

export default function Page({ searchParams }: { searchParams: Promise<{ unidad?: string }> }) {
  return (
    <Pagina>
      <Contenido searchParams={searchParams} />
    </Pagina>
  )
}
