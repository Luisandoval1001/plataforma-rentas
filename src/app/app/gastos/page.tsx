import Link from 'next/link'
import { Encabezado, Pagina } from '@/app/app/_components/Pagina'
import { BotonEnlace, claseBoton } from '@/components/ui/Boton'
import { CampoSelect } from '@/components/ui/Campo'
import { Celda, Tabla } from '@/components/ui/Tabla'
import { requireRol } from '@/lib/auth/session'
import { dinero, fecha } from '@/lib/formato'
import { opcionesCobranza } from '@/lib/queries/cobranza'
import { gastosLista } from '@/lib/queries/liquidaciones'
import { getFileUrl } from '@/lib/storage'
import { PAGADO_POR_TEXTO } from '@/lib/validators/gasto'

type Busqueda = Promise<Record<string, string | string[] | undefined>>

const uno = (q: Record<string, string | string[] | undefined>, k: string) => {
  const v = q[k]
  return typeof v === 'string' && v !== '' ? v : undefined
}

async function Contenido({ searchParams }: { searchParams: Busqueda }) {
  const session = await requireRol('admin', 'equipo')
  const q = await searchParams
  const filtros = { inmuebleId: uno(q, 'inmueble'), propietarioId: uno(q, 'propietario'), periodo: uno(q, 'periodo') }
  const [opciones, filas] = await Promise.all([opcionesCobranza(session), gastosLista(session, filtros)])
  const urls = await Promise.all(filas.map((g) => (g.comprobante_path ? getFileUrl(g.comprobante_path) : null)))
  const total = filas.reduce((s, g) => s + Number(g.monto), 0)
  const opc = (xs: { id: string; nombre: string }[]) => xs.map((x) => ({ valor: x.id, texto: x.nombre }))
  return (
    <>
      <Encabezado titulo="Gastos">
        <BotonEnlace href="/app/gastos/nuevo">Nuevo gasto</BotonEnlace>
      </Encabezado>
      <form method="get" className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-4">
        <div className="space-y-1">
          <label htmlFor="filtro-periodo" className="block text-sm font-medium text-gray-800">
            Mes
          </label>
          <input
            id="filtro-periodo"
            type="month"
            name="periodo"
            defaultValue={filtros.periodo ?? ''}
            className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-base"
          />
        </div>
        <CampoSelect etiqueta="Inmueble" name="inmueble" vacio="Todos" opciones={opc(opciones.inmuebles)} defaultValue={filtros.inmuebleId ?? ''} />
        <CampoSelect etiqueta="Propietario" name="propietario" vacio="Todos" opciones={opc(opciones.propietarios)} defaultValue={filtros.propietarioId ?? ''} />
        <div className="flex items-end">
          <button type="submit" className={`${claseBoton('secundario')} w-full`}>
            Filtrar
          </button>
        </div>
      </form>
      <p className="text-sm text-gray-700">
        {filas.length} gastos · total <span className="font-semibold">{dinero(total)}</span>
      </p>
      <Tabla columnas={['Fecha', 'Inmueble', 'Unidad', 'Concepto', 'Monto', 'Pagado por', 'Autorizó', 'Comprobante', '']} vacio="Sin gastos">
        {filas.map((g, i) => (
          <tr key={g.id}>
            <Celda>{fecha(g.fecha)}</Celda>
            <Celda>{g.inmueble_nombre}</Celda>
            <Celda>{g.unidad_nombre ?? '—'}</Celda>
            <Celda className="whitespace-normal">{g.concepto}</Celda>
            <Celda className="text-right">{dinero(g.monto)}</Celda>
            <Celda>{PAGADO_POR_TEXTO[g.pagado_por]}</Celda>
            <Celda>{g.autorizado_por ?? '—'}</Celda>
            <Celda>
              {urls[i] ? (
                <a href={urls[i]!} target="_blank" rel="noreferrer" className="text-blue-700 underline">
                  Ver
                </a>
              ) : (
                '—'
              )}
            </Celda>
            <Celda>
              <Link href={`/app/gastos/${g.id}`} className="text-blue-700 underline">
                Editar
              </Link>
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
