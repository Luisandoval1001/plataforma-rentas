import { crearGasto } from '@/app/app/_actions/gastos'
import { Encabezado, Pagina } from '@/app/app/_components/Pagina'
import { requireRol } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import { opcionesUnidades } from '@/lib/queries/contratos'
import { hoyIso } from '@/lib/formato'
import { FormularioGasto } from '../_components/FormularioGasto'

async function Contenido() {
  const session = await requireRol('admin', 'equipo')
  const { inmuebles, unidades } = await withSession(session, opcionesUnidades)
  return (
    <>
      <Encabezado titulo="Nuevo gasto" />
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <FormularioGasto
          accion={crearGasto}
          inmuebles={inmuebles}
          unidades={unidades}
          hoy={hoyIso()}
          conComprobante
          textoBoton="Guardar gasto"
        />
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
