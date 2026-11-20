import { Encabezado, Pagina } from '@/app/app/_components/Pagina'
import { requireRol } from '@/lib/auth/session'
import { cargosDelMes, filtrosDesdeUrl, opcionesCobranza } from '@/lib/queries/cobranza'
import { dinero } from '@/lib/formato'
import { FiltrosCobranza } from './_components/FiltrosCobranza'
import { GenerarCargos } from './_components/GenerarCargos'
import { TablaCargos } from './_components/TablaCargos'

type Busqueda = Promise<Record<string, string | string[] | undefined>>

function mesActual() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

async function Contenido({ searchParams }: { searchParams: Busqueda }) {
  const session = await requireRol('admin', 'equipo')
  const filtros = filtrosDesdeUrl(await searchParams)
  const opciones = await opcionesCobranza(session)
  const cobrador = filtros.cobradorId === undefined ? opciones.porDefecto : filtros.cobradorId
  const filas = await cargosDelMes(session, { ...filtros, cobradorId: cobrador })
  const saldo = filas.reduce((s, c) => s + Number(c.saldo), 0)
  return (
    <>
      <Encabezado titulo="Cobranza">{session.rol === 'admin' && <GenerarCargos />}</Encabezado>
      <FiltrosCobranza
        filtros={filtros}
        periodo={filtros.periodo ?? mesActual()}
        cobrador={cobrador}
        inmuebles={opciones.inmuebles}
        propietarios={opciones.propietarios}
        cobradores={opciones.cobradores}
      />
      <p className="text-sm text-gray-700">
        {filas.length} cargos · saldo por cobrar <span className="font-semibold">{dinero(saldo)}</span>
      </p>
      <TablaCargos filas={filas} />
    </>
  )
}

export default function Page({ searchParams }: { searchParams: Busqueda }) {
  return (
    <Pagina>
      <Contenido searchParams={searchParams} />
    </Pagina>
  )
}
