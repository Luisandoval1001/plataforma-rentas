import Link from 'next/link'
import { Encabezado, Pagina } from '@/app/app/_components/Pagina'
import { claseBoton } from '@/components/ui/Boton'
import { Celda, Tabla } from '@/components/ui/Tabla'
import { requireRol } from '@/lib/auth/session'
import { dinero, mesAnteriorIso } from '@/lib/formato'
import { liquidacionesResumen } from '@/lib/queries/liquidaciones'
import { MODELO_TEXTO } from '@/lib/queries/propietarios'
import { Preparar } from './_components/Acciones'
import { EstatusLiquidacion } from './_components/EstatusLiquidacion'

type Busqueda = Promise<Record<string, string | string[] | undefined>>

async function Contenido({ searchParams }: { searchParams: Busqueda }) {
  const session = await requireRol('admin', 'equipo')
  const q = (await searchParams).periodo
  const periodo = typeof q === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(q) ? q : mesAnteriorIso()
  const filas = await liquidacionesResumen(session, { periodo })
  return (
    <>
      <Encabezado titulo="Liquidaciones" />
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4">
        <div className="space-y-1">
          <label htmlFor="periodo" className="block text-sm font-medium text-gray-800">
            Mes
          </label>
          <input
            id="periodo"
            type="month"
            name="periodo"
            defaultValue={periodo}
            className="block rounded-md border border-gray-300 bg-white px-3 py-2 text-base"
          />
        </div>
        <button type="submit" className={claseBoton('secundario')}>
          Ver mes
        </button>
      </form>
      <Tabla columnas={['Propietario', 'Modelo', 'Estatus', 'Neto', '']} vacio="Sin propietarios activos">
        {filas.map((f) => (
          <tr key={f.propietario_id}>
            <Celda>{f.propietario_nombre}</Celda>
            <Celda>{MODELO_TEXTO[f.modelo]}</Celda>
            <Celda>
              <EstatusLiquidacion estatus={f.estatus} />
            </Celda>
            <Celda className="text-right">{f.neto == null ? '—' : dinero(f.neto)}</Celda>
            <Celda>
              <div className="flex flex-wrap items-start gap-2">
                {(f.estatus == null || f.estatus === 'borrador') && (
                  <Preparar propietarioId={f.propietario_id} periodo={periodo} texto={f.estatus ? 'Volver a preparar' : 'Preparar'} />
                )}
                {f.liquidacion_id && (
                  <Link href={`/app/liquidaciones/${f.liquidacion_id}`} className={claseBoton('secundario')}>
                    Ver
                  </Link>
                )}
              </div>
            </Celda>
          </tr>
        ))}
      </Tabla>
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
