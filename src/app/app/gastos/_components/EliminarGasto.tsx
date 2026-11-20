'use client'

import { eliminarGasto } from '@/app/app/_actions/gastos'
import { Formulario } from '@/components/ui/Formulario'

/** Sólo admin: borra un gasto que aún no está en una liquidación cerrada. */
export function EliminarGasto({ id }: { id: string }) {
  return (
    <Formulario
      accion={() => eliminarGasto(id)}
      textoBoton="Eliminar gasto"
      variante="peligro"
      redirigirA="/app/gastos"
      confirmar="¿Eliminar este gasto? No se puede deshacer."
    />
  )
}
