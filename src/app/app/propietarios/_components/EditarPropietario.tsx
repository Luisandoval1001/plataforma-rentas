'use client'

import { useState, type ReactNode } from 'react'
import { Boton } from '@/components/ui/Boton'
import { Formulario } from '@/components/ui/Formulario'
import type { Resultado } from '@/lib/acciones'

/** Botón "Editar comisión" que despliega el formulario de edición (sólo se renderiza para admin). */
export function EditarPropietario({
  accion,
  children,
}: {
  accion: (fd: FormData) => Promise<Resultado>
  children: ReactNode
}) {
  const [abierto, setAbierto] = useState(false)
  if (!abierto) {
    return (
      <Boton variante="secundario" onClick={() => setAbierto(true)}>
        Editar comisión
      </Boton>
    )
  }
  return (
    <Formulario accion={accion} textoBoton="Guardar cambios" mensajeExito="Cambios guardados">
      {children}
    </Formulario>
  )
}
