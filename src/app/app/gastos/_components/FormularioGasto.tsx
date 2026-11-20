'use client'

import { useState } from 'react'
import { Campo, CampoSelect } from '@/components/ui/Campo'
import { Formulario } from '@/components/ui/Formulario'
import type { Resultado } from '@/lib/acciones'
import { PAGADO_POR, PAGADO_POR_TEXTO } from '@/lib/validators/gasto'

type Item = { id: string; nombre: string }

export type GastoInicial = {
  inmuebleId: string
  unidadId: string
  fecha: string
  concepto: string
  monto: string
  pagadoPor: string
  autorizadoPor: string
}

/** Alta/edición de gasto: inmueble → unidad (opcional). El comprobante sólo en el alta. */
export function FormularioGasto({
  accion,
  inmuebles,
  unidades,
  inicial,
  hoy,
  conComprobante,
  textoBoton,
}: {
  accion: (fd: FormData) => Promise<Resultado>
  inmuebles: Item[]
  unidades: (Item & { inmueble_id: string })[]
  inicial?: GastoInicial
  hoy: string
  conComprobante: boolean
  textoBoton: string
}) {
  const [inmuebleId, setInmuebleId] = useState(inicial?.inmuebleId ?? '')
  const [unidadId, setUnidadId] = useState(inicial?.unidadId ?? '')
  const opc = (xs: Item[]) => xs.map((x) => ({ valor: x.id, texto: x.nombre }))
  return (
    <Formulario accion={accion} textoBoton={textoBoton} redirigirA="/app/gastos">
      <CampoSelect
        etiqueta="Inmueble"
        name="inmuebleId"
        value={inmuebleId}
        onChange={(e) => {
          setInmuebleId(e.target.value)
          setUnidadId('')
        }}
        vacio="Selecciona…"
        opciones={opc(inmuebles)}
      />
      <CampoSelect
        etiqueta="Unidad"
        name="unidadId"
        value={unidadId}
        onChange={(e) => setUnidadId(e.target.value)}
        vacio="Todo el inmueble"
        opciones={opc(unidades.filter((u) => u.inmueble_id === inmuebleId))}
        disabled={!inmuebleId}
      />
      <Campo etiqueta="Fecha" name="fecha" type="date" defaultValue={inicial?.fecha ?? hoy} required />
      <Campo etiqueta="Concepto" name="concepto" defaultValue={inicial?.concepto} required />
      <Campo etiqueta="Monto" name="monto" inputMode="decimal" defaultValue={inicial?.monto} required />
      <CampoSelect
        etiqueta="Pagado por"
        name="pagadoPor"
        defaultValue={inicial?.pagadoPor ?? ''}
        vacio="Selecciona…"
        opciones={PAGADO_POR.map((p) => ({ valor: p, texto: PAGADO_POR_TEXTO[p] }))}
      />
      <Campo etiqueta="Autorizado por" name="autorizadoPor" defaultValue={inicial?.autorizadoPor} />
      {conComprobante && (
        <Campo
          etiqueta="Comprobante (opcional)"
          name="comprobante"
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          ayuda="PDF o foto, hasta 4 MB"
        />
      )}
    </Formulario>
  )
}
