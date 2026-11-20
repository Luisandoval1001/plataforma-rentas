'use client'

import { actualizarDocumento, eliminarDocumento } from '@/app/app/_actions/documentos'
import { Campo, CampoCasilla, CampoSelect } from '@/components/ui/Campo'
import { Formulario } from '@/components/ui/Formulario'
import { TIPOS_DOCUMENTO, TIPO_DOCUMENTO_TEXTO } from '@/lib/validators/documento'

/** Editar nombre, tipo y visibilidad; eliminar sólo admin. */
export function AccionesDocumento({
  doc,
  esAdmin,
}: {
  doc: { id: string; nombre: string; tipo: string; visible_propietario: boolean }
  esAdmin: boolean
}) {
  return (
    <details>
      <summary className="cursor-pointer text-blue-700 underline">Editar</summary>
      <div className="mt-2 w-72 space-y-3 whitespace-normal">
        <Formulario
          accion={(fd) =>
            actualizarDocumento(doc.id, {
              nombre: String(fd.get('nombre') ?? ''),
              tipo: String(fd.get('tipo') ?? ''),
              visiblePropietario: fd.get('visiblePropietario') === 'on',
            })
          }
          mensajeExito="Guardado"
        >
          <Campo etiqueta="Nombre" name="nombre" defaultValue={doc.nombre} required />
          <CampoSelect
            etiqueta="Tipo"
            name="tipo"
            defaultValue={doc.tipo}
            opciones={TIPOS_DOCUMENTO.map((t) => ({ valor: t, texto: TIPO_DOCUMENTO_TEXTO[t] }))}
          />
          <CampoCasilla etiqueta="Visible para el propietario" name="visiblePropietario" defaultChecked={doc.visible_propietario} />
        </Formulario>
        {esAdmin && (
          <Formulario
            accion={() => eliminarDocumento(doc.id)}
            textoBoton="Eliminar"
            variante="peligro"
            confirmar="¿Eliminar este documento?"
          />
        )}
      </div>
    </details>
  )
}
