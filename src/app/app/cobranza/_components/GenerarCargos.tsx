'use client'

import { generarCargosMes } from '@/app/app/_actions/cobranza'
import { Formulario } from '@/components/ui/Formulario'

/** Sólo admin: genera los cargos de renta del mes en curso (idempotente). */
export function GenerarCargos() {
  return (
    <Formulario
      accion={() => generarCargosMes()}
      textoBoton="Generar cargos del mes"
      variante="secundario"
      className="flex flex-col items-end gap-2"
      mensajeExito={(n) => (n === '1' ? 'Se generó 1 cargo' : `Se generaron ${n} cargos`)}
      confirmar="¿Generar los cargos de renta del mes en curso? Los que ya existen no se duplican."
    />
  )
}
