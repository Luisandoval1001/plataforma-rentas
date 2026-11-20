import { CampoSelect } from '@/components/ui/Campo'
import { claseBoton } from '@/components/ui/Boton'
import { ESTATUS_CARGO, type FiltrosCobranza as Filtros, type Opcion } from '@/lib/queries/cobranza'

const opciones = (xs: Opcion[]) => xs.map((x) => ({ valor: x.id, texto: x.nombre }))

/** Filtros por GET: la URL guarda la vista y se puede compartir. */
export function FiltrosCobranza({
  filtros,
  periodo,
  cobrador,
  inmuebles,
  propietarios,
  cobradores,
}: {
  filtros: Filtros
  periodo: string
  cobrador: string | null
  inmuebles: Opcion[]
  propietarios: Opcion[]
  cobradores: Opcion[]
}) {
  return (
    <form method="get" className="grid grid-cols-1 gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6">
      <div className="space-y-1">
        <label htmlFor="filtro-periodo" className="block text-sm font-medium text-gray-800">
          Mes
        </label>
        <input
          id="filtro-periodo"
          type="month"
          name="periodo"
          defaultValue={periodo}
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-base"
        />
      </div>
      <CampoSelect etiqueta="Inmueble" name="inmueble" vacio="Todos" opciones={opciones(inmuebles)} defaultValue={filtros.inmuebleId ?? ''} />
      <CampoSelect etiqueta="Propietario" name="propietario" vacio="Todos" opciones={opciones(propietarios)} defaultValue={filtros.propietarioId ?? ''} />
      <CampoSelect
        etiqueta="Estatus"
        name="estatus"
        vacio="Todos"
        opciones={ESTATUS_CARGO.map((e) => ({ valor: e, texto: e }))}
        defaultValue={filtros.estatus ?? ''}
      />
      <CampoSelect
        etiqueta="Cobrador"
        name="cobrador"
        opciones={[{ valor: 'todos', texto: 'Todos' }, ...opciones(cobradores)]}
        defaultValue={cobrador ?? 'todos'}
      />
      <div className="flex items-end">
        <button type="submit" className={`${claseBoton('secundario')} w-full`}>
          Filtrar
        </button>
      </div>
    </form>
  )
}
