import Link from 'next/link'
import { Encabezado, Pagina } from '@/app/app/_components/Pagina'
import { BotonEnlace } from '@/components/ui/Boton'
import { Celda, Tabla } from '@/components/ui/Tabla'
import { requireRol } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import { dinero, fecha } from '@/lib/formato'
import { listarContratos } from '@/lib/queries/contratos'
import { EstatusContrato } from './_components/EstatusContrato'

async function Contenido() {
  const session = await requireRol('admin', 'equipo')
  const contratos = await withSession(session, listarContratos)
  return (
    <>
      <Encabezado titulo="Contratos">
        <BotonEnlace href="/app/contratos/nuevo">Nuevo contrato</BotonEnlace>
      </Encabezado>
      <Tabla columnas={['Unidad', 'Inquilino', 'Propietario', 'Renta actual', 'Vigencia', 'Estatus']} vacio="Aún no hay contratos">
        {contratos.map((c) => (
          <tr key={c.id}>
            <Celda>
              <Link href={`/app/contratos/${c.id}`} className="text-blue-700 underline">
                {c.inmueble_nombre} · {c.unidad_nombre}
              </Link>
            </Celda>
            <Celda>{c.inquilino_nombre}</Celda>
            <Celda>{c.propietario_nombre}</Celda>
            <Celda>{dinero(c.renta_actual)}</Celda>
            <Celda>
              {fecha(c.fecha_inicio)} – {fecha(c.fecha_fin)}
            </Celda>
            <Celda>
              <EstatusContrato estatus={c.estatus_calc} desde={c.pendiente_firma_desde} />
            </Celda>
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
