'use client'

import { useEffect, useId, useRef } from 'react'
import { registrarPago } from '@/app/app/_actions/cobranza'
import { Boton } from '@/components/ui/Boton'
import { Campo, CampoSelect } from '@/components/ui/Campo'
import { Formulario } from '@/components/ui/Formulario'
import { dinero } from '@/lib/formato'

export type CargoAPagar = { id: string; etiqueta: string; saldo: string }

const METODOS = [
  { valor: 'transferencia', texto: 'Transferencia' },
  { valor: 'deposito', texto: 'Depósito' },
  { valor: 'efectivo', texto: 'Efectivo' },
  { valor: 'otro', texto: 'Otro' },
]
const CUENTAS = [
  { valor: 'disa', texto: 'Cuenta DISA' },
  { valor: 'propietario', texto: 'Cuenta del propietario' },
]

function hoyIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Diálogo para registrar un pago sobre uno o varios cargos (del mismo propietario). `cargos` null → cerrado.
 * La cuenta destino por omisión sale del modelo del propietario (cobra_disa → DISA; si no, propietario):
 * la liquidación se calcula con la cuenta real de cada pago.
 */
export function RegistrarPagoDialog({
  cargos,
  modelo,
  alCerrar,
}: {
  cargos: CargoAPagar[] | null
  modelo: 'cobra_disa' | 'cobra_propietario'
  alCerrar: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titulo = useId()

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (cargos && !d.open) d.showModal()
    if (!cargos && d.open) d.close()
  }, [cargos])

  const total = (cargos ?? []).reduce((s, c) => s + Number(c.saldo), 0)
  return (
    <dialog
      ref={ref}
      aria-labelledby={titulo}
      onClose={alCerrar}
      className="m-auto w-[min(100%-1rem,32rem)] rounded-lg p-0 backdrop:bg-black/40"
    >
      {cargos && (
        <div className="space-y-4 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 id={titulo} className="text-lg font-semibold">
              Registrar pago
            </h2>
            <Boton variante="secundario" onClick={() => ref.current?.close()}>
              Cerrar
            </Boton>
          </div>
          <ul className="space-y-1 text-sm">
            {cargos.map((c) => (
              <li key={c.id} className="flex justify-between gap-3">
                <span>{c.etiqueta}</span>
                <span className="font-medium">Saldo {dinero(c.saldo)}</span>
              </li>
            ))}
          </ul>
          <Formulario accion={registrarPago} textoBoton="Guardar pago" alExito={() => ref.current?.close()}>
            {cargos.map((c) => (
              <input key={c.id} type="hidden" name="cargoIds" value={c.id} />
            ))}
            <Campo etiqueta="Monto" name="monto" inputMode="decimal" defaultValue={total.toFixed(2)} required />
            <Campo etiqueta="Fecha del pago" name="fecha" type="date" defaultValue={hoyIso()} required />
            <CampoSelect etiqueta="Método" name="metodo" opciones={METODOS} defaultValue="transferencia" />
            <Campo etiqueta="Referencia" name="referencia" ayuda="Folio o clave de rastreo; vacío si es efectivo" />
            <CampoSelect
              etiqueta="Cuenta destino"
              name="cuenta"
              opciones={CUENTAS}
              defaultValue={modelo === 'cobra_disa' ? 'disa' : 'propietario'}
            />
            <Campo
              etiqueta="Comprobante (opcional)"
              name="comprobante"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              ayuda="Foto o PDF, hasta 4 MB"
            />
          </Formulario>
        </div>
      )}
    </dialog>
  )
}
