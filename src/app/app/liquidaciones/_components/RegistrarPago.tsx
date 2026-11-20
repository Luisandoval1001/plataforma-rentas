'use client'

import { pagarLiquidacion } from '@/app/app/_actions/liquidaciones'
import { Campo } from '@/components/ui/Campo'
import { Formulario } from '@/components/ui/Formulario'

/** Pago al propietario (o cobro del saldo) de una liquidación cerrada. */
export function RegistrarPago({ id, hoy }: { id: string; hoy: string }) {
  return (
    <Formulario accion={pagarLiquidacion.bind(null, id)} textoBoton="Registrar pago">
      <Campo etiqueta="Fecha del pago" name="fecha" type="date" defaultValue={hoy} required />
      <Campo etiqueta="Referencia" name="referencia" />
      <Campo
        etiqueta="Comprobante (opcional)"
        name="comprobante"
        type="file"
        accept="application/pdf,image/jpeg,image/png,image/webp"
        ayuda="PDF o foto, hasta 4 MB"
      />
    </Formulario>
  )
}
