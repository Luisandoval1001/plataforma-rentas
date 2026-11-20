'use client'

import {
  cerrarLiquidacion,
  prepararLiquidacion,
  regenerarPdfLiquidacion,
  registrarAjuste,
} from '@/app/app/_actions/liquidaciones'
import { Campo } from '@/components/ui/Campo'
import { Formulario } from '@/components/ui/Formulario'

const EN_LINEA = 'flex flex-col items-start gap-2'

/** Crea (o vuelve a calcular) el borrador y abre su detalle. */
export function Preparar({ propietarioId, periodo, texto = 'Preparar' }: { propietarioId: string; periodo: string; texto?: string }) {
  return (
    <Formulario
      accion={() => prepararLiquidacion(propietarioId, periodo)}
      textoBoton={texto}
      variante="secundario"
      className={EN_LINEA}
      redirigirA="/app/liquidaciones/:id"
    />
  )
}

/** Sólo admin. Al cerrar se genera el PDF y se avisa al propietario. */
export function Cerrar({ id }: { id: string }) {
  return (
    <Formulario
      accion={() => cerrarLiquidacion(id)}
      textoBoton="Cerrar liquidación"
      className={EN_LINEA}
      confirmar="¿Cerrar la liquidación? Ya no se podrá modificar; se generará el PDF y se avisará al propietario."
    />
  )
}

export function RegenerarPdf({ id }: { id: string }) {
  return (
    <Formulario
      accion={() => regenerarPdfLiquidacion(id)}
      textoBoton="Regenerar PDF"
      variante="secundario"
      className={EN_LINEA}
      mensajeExito="PDF generado"
    />
  )
}

/** Sólo admin: corrección que entra en la siguiente liquidación del propietario. */
export function RegistrarAjuste({ propietarioId }: { propietarioId: string }) {
  return (
    <Formulario
      accion={(fd) => registrarAjuste(propietarioId, String(fd.get('monto') ?? ''), String(fd.get('descripcion') ?? ''))}
      textoBoton="Registrar ajuste"
      variante="secundario"
      mensajeExito="Ajuste registrado; entrará en la siguiente liquidación"
      limpiar
    >
      <Campo etiqueta="Monto del ajuste" name="monto" inputMode="decimal" ayuda="Negativo si descuenta al propietario" required />
      <Campo etiqueta="Descripción" name="descripcion" required />
    </Formulario>
  )
}
