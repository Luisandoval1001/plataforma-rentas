'use client'

import { useState } from 'react'
import { crearContrato } from '@/app/app/_actions/contratos'
import { Campo, CampoSelect } from '@/components/ui/Campo'
import { Formulario } from '@/components/ui/Formulario'

type Item = { id: string; nombre: string }

/** Alta de contrato: propietario → inmueble → unidad; inquilino existente o nuevo; PDF opcional. */
export function FormularioContrato({
  propietarios,
  inmuebles,
  unidades,
  inquilinos,
  unidadInicial,
}: {
  propietarios: Item[]
  inmuebles: (Item & { propietario_id: string })[]
  unidades: (Item & { inmueble_id: string })[]
  inquilinos: Item[]
  unidadInicial?: string
}) {
  const uIni = unidades.find((u) => u.id === unidadInicial)
  const iIni = inmuebles.find((i) => i.id === uIni?.inmueble_id)
  const [propietarioId, setPropietarioId] = useState(iIni?.propietario_id ?? '')
  const [inmuebleId, setInmuebleId] = useState(iIni?.id ?? '')
  const [unidadId, setUnidadId] = useState(uIni?.id ?? '')
  const [inquilinoId, setInquilinoId] = useState('')

  const opc = (xs: Item[]) => xs.map((x) => ({ valor: x.id, texto: x.nombre }))
  return (
    <Formulario accion={crearContrato} textoBoton="Guardar contrato" redirigirA="/app/contratos/:id">
      <CampoSelect
        etiqueta="Propietario"
        name="propietario"
        value={propietarioId}
        onChange={(e) => {
          setPropietarioId(e.target.value)
          setInmuebleId('')
          setUnidadId('')
        }}
        vacio="Selecciona…"
        opciones={opc(propietarios)}
      />
      <CampoSelect
        etiqueta="Inmueble"
        name="inmueble"
        value={inmuebleId}
        onChange={(e) => {
          setInmuebleId(e.target.value)
          setUnidadId('')
        }}
        vacio="Selecciona…"
        opciones={opc(inmuebles.filter((i) => i.propietario_id === propietarioId))}
        disabled={!propietarioId}
      />
      <CampoSelect
        etiqueta="Unidad"
        name="unidad_id"
        value={unidadId}
        onChange={(e) => setUnidadId(e.target.value)}
        vacio="Selecciona…"
        opciones={opc(unidades.filter((u) => u.inmueble_id === inmuebleId))}
        disabled={!inmuebleId}
      />
      <CampoSelect
        etiqueta="Inquilino"
        name="inquilino_id"
        value={inquilinoId}
        onChange={(e) => setInquilinoId(e.target.value)}
        vacio="— Inquilino nuevo —"
        opciones={opc(inquilinos)}
      />
      {inquilinoId === '' && (
        <fieldset className="space-y-4 rounded-md border border-gray-200 p-3">
          <legend className="px-1 text-sm font-medium text-gray-800">Inquilino nuevo</legend>
          <Campo etiqueta="Nombre del inquilino" name="inquilino_nombre" />
          <Campo etiqueta="Correo del inquilino" name="inquilino_email" type="email" />
          <Campo etiqueta="Teléfono del inquilino" name="inquilino_telefono" type="tel" />
          <Campo etiqueta="RFC del inquilino" name="inquilino_rfc" autoCapitalize="characters" />
        </fieldset>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Campo etiqueta="Fecha de inicio" name="fecha_inicio" type="date" required />
        <Campo etiqueta="Fecha de fin" name="fecha_fin" type="date" required />
        <Campo etiqueta="Renta mensual" name="renta_mensual" inputMode="decimal" required />
        <Campo etiqueta="Día de pago" name="dia_pago" type="number" min={1} max={28} required />
        <Campo etiqueta="Depósito en garantía" name="deposito" inputMode="decimal" />
        <Campo etiqueta="Incremento anual (%)" name="incremento_anual_pct" inputMode="decimal" />
      </div>
      <Campo etiqueta="Contrato firmado (PDF)" name="pdf" type="file" accept="application/pdf" ayuda="PDF, hasta 4 MB" />
    </Formulario>
  )
}
