'use client'

import { useState } from 'react'
import { subirDocumento } from '@/app/app/_actions/documentos'
import { Campo, CampoCasilla, CampoSelect } from '@/components/ui/Campo'
import { Formulario } from '@/components/ui/Formulario'
import { TIPOS_DOCUMENTO, TIPO_DOCUMENTO_TEXTO } from '@/lib/validators/documento'

type Item = { id: string; nombre: string }

/** Alta de documento. Factura: PDF y XML (se guardan como dos documentos con el mismo nombre). */
export function SubirDocumento({
  propietarioId,
  unidades,
  liquidaciones,
}: {
  propietarioId: string
  unidades: Item[]
  liquidaciones: Item[]
}) {
  const [tipo, setTipo] = useState('')
  const esFactura = tipo === 'factura'
  return (
    <Formulario accion={subirDocumento.bind(null, propietarioId)} textoBoton="Subir documento" mensajeExito="Documento guardado" limpiar>
      <CampoSelect
        etiqueta="Tipo"
        name="tipo"
        value={tipo}
        onChange={(e) => setTipo(e.target.value)}
        vacio="Selecciona…"
        opciones={TIPOS_DOCUMENTO.map((t) => ({ valor: t, texto: TIPO_DOCUMENTO_TEXTO[t] }))}
      />
      <Campo etiqueta="Nombre" name="nombre" required />
      <Campo
        etiqueta={esFactura ? 'PDF de la factura' : 'Archivo'}
        name="archivo"
        type="file"
        accept={esFactura ? 'application/pdf' : 'application/pdf,image/jpeg,image/png,image/webp'}
        ayuda={esFactura ? 'PDF, hasta 4 MB' : 'PDF o foto, hasta 4 MB'}
        required
      />
      {esFactura && (
        <Campo etiqueta="XML de la factura (opcional)" name="xml" type="file" accept=".xml,application/xml,text/xml" />
      )}
      <CampoSelect etiqueta="Unidad (opcional)" name="unidadId" vacio="Ninguna" opciones={unidades.map((u) => ({ valor: u.id, texto: u.nombre }))} />
      <CampoSelect
        etiqueta="Liquidación (opcional)"
        name="liquidacionId"
        vacio="Ninguna"
        opciones={liquidaciones.map((l) => ({ valor: l.id, texto: l.nombre }))}
      />
      <CampoCasilla etiqueta="Visible para el propietario" name="visiblePropietario" defaultChecked />
    </Formulario>
  )
}
