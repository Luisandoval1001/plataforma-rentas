import { Campo, CampoSelect, type Opcion } from '@/components/ui/Campo'
import type { Inmueble } from '@/lib/queries/inmuebles'
import { TIPOS_INMUEBLE } from '@/lib/validators/inmueble'

const TIPO_TEXTO: Record<(typeof TIPOS_INMUEBLE)[number], string> = {
  departamento: 'Departamento',
  casa: 'Casa',
  edificio: 'Edificio',
  local: 'Local',
  terreno: 'Terreno',
  nave: 'Nave',
  otro: 'Otro',
}

export const textoTipo = (t: string) => TIPO_TEXTO[t as keyof typeof TIPO_TEXTO] ?? t

export function CamposInmueble({ i, cobradores }: { i?: Inmueble; cobradores: Opcion[] }) {
  return (
    <>
      <Campo etiqueta="Nombre" name="nombre" defaultValue={i?.nombre} required />
      <Campo etiqueta="Dirección" name="direccion" defaultValue={i?.direccion ?? ''} />
      <CampoSelect
        etiqueta="Tipo"
        name="tipo"
        defaultValue={i?.tipo ?? ''}
        vacio="Selecciona…"
        opciones={TIPOS_INMUEBLE.map((t) => ({ valor: t, texto: TIPO_TEXTO[t] }))}
        required
      />
      <CampoSelect
        etiqueta="Cobrador asignado"
        name="cobrador_id"
        defaultValue={i?.cobrador_id ?? ''}
        vacio="Sin asignar"
        opciones={cobradores}
      />
    </>
  )
}
