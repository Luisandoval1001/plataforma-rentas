import { notFound } from 'next/navigation'
import { actualizarGasto } from '@/app/app/_actions/gastos'
import { Encabezado, Pagina } from '@/app/app/_components/Pagina'
import { requireRol } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import { mesIso } from '@/lib/formato'
import { opcionesUnidades } from '@/lib/queries/contratos'
import { obtenerGasto } from '@/lib/queries/liquidaciones'
import { EliminarGasto } from '../_components/EliminarGasto'
import { FormularioGasto } from '../_components/FormularioGasto'

async function Contenido({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRol('admin', 'equipo')
  const { id } = await params
  const g = await obtenerGasto(session, id)
  if (!g) notFound()
  const { inmuebles, unidades } = await withSession(session, opcionesUnidades)
  const fechaIso = `${mesIso(g.fecha)}-${String(g.fecha.getUTCDate()).padStart(2, '0')}`
  return (
    <>
      <Encabezado titulo="Editar gasto" />
      <p className="text-sm text-gray-600">
        Un gasto que ya forma parte de una liquidación cerrada no se puede cambiar; las correcciones se hacen con un ajuste.
      </p>
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <FormularioGasto
          accion={actualizarGasto.bind(null, g.id)}
          inmuebles={inmuebles}
          unidades={unidades}
          inicial={{
            inmuebleId: g.inmueble_id,
            unidadId: g.unidad_id ?? '',
            fecha: fechaIso,
            concepto: g.concepto,
            monto: String(Number(g.monto)),
            pagadoPor: g.pagado_por,
            autorizadoPor: g.autorizado_por ?? '',
          }}
          hoy={fechaIso}
          conComprobante={false}
          textoBoton="Guardar cambios"
        />
      </div>
      {session.rol === 'admin' && <EliminarGasto id={g.id} />}
    </>
  )
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Pagina>
      <Contenido params={params} />
    </Pagina>
  )
}
