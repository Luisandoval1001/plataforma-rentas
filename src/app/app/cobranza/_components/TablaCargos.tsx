'use client'

import { useState } from 'react'
import { Boton } from '@/components/ui/Boton'
import { Celda, Tabla } from '@/components/ui/Tabla'
import { dinero, fecha, mes } from '@/lib/formato'
import type { CargoFila } from '@/lib/queries/cobranza'
import { EstatusCargo } from './EstatusCargo'
import { NotaCargo } from './NotaCargo'
import { PagosCargo } from './PagosCargo'
import { RegistrarPagoDialog, type CargoAPagar } from './RegistrarPagoDialog'

const COLUMNAS = ['Elegir', 'Unidad', 'Inquilino', 'Periodo', 'Monto', 'Pagado', 'Saldo', 'Estatus', 'Atraso', 'Fecha límite', 'Notas', 'Pagos', 'Acciones']

const aPagar = (c: CargoFila): CargoAPagar => ({
  id: c.id,
  etiqueta: `${c.inmueble_nombre} · ${c.unidad_nombre} · ${mes(c.periodo)}${c.tipo === 'renta' ? '' : ` (${c.tipo})`}`,
  saldo: c.saldo,
})

/** Cargos con selección múltiple (sólo del mismo propietario) para pagar varios a la vez. */
export function TablaCargos({ filas }: { filas: CargoFila[] }) {
  const [seleccion, setSeleccion] = useState<string[]>([])
  const [dialogo, setDialogo] = useState<{ cargos: CargoAPagar[]; modelo: CargoFila['propietario_modelo'] } | null>(null)
  const elegidos = filas.filter((c) => seleccion.includes(c.id) && Number(c.saldo) > 0)
  const propietario = elegidos[0]?.propietario_id

  function alternar(id: string) {
    setSeleccion((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Boton disabled={elegidos.length === 0} onClick={() => setDialogo({ cargos: elegidos.map(aPagar), modelo: elegidos[0].propietario_modelo })}>
          Pagar seleccionados ({elegidos.length})
        </Boton>
        <p className="text-sm text-gray-600">Para pagar varios cargos juntos deben ser del mismo propietario.</p>
      </div>
      <Tabla columnas={COLUMNAS} vacio="No hay cargos con estos filtros">
        {filas.map((c) => {
          const pagable = Number(c.saldo) > 0
          return (
            <tr key={c.id} className="align-top">
              <Celda>
                <input
                  type="checkbox"
                  aria-label={`Elegir ${c.inmueble_nombre} ${c.unidad_nombre}`}
                  className="h-5 w-5"
                  checked={seleccion.includes(c.id)}
                  disabled={!pagable || (propietario !== undefined && propietario !== c.propietario_id)}
                  onChange={() => alternar(c.id)}
                />
              </Celda>
              <Celda>
                {c.inmueble_nombre} · {c.unidad_nombre}
                {c.tipo !== 'renta' && <span className="text-gray-500"> ({c.tipo})</span>}
              </Celda>
              <Celda>{c.inquilino_nombre}</Celda>
              <Celda>{mes(c.periodo)}</Celda>
              <Celda>{dinero(c.monto)}</Celda>
              <Celda>{dinero(c.pagado)}</Celda>
              <Celda className="font-medium">{dinero(c.saldo)}</Celda>
              <Celda>
                <EstatusCargo estatus={c.estatus} />
              </Celda>
              <Celda>{c.dias_atraso > 0 ? `${c.dias_atraso} días` : '—'}</Celda>
              <Celda>{fecha(c.fecha_limite)}</Celda>
              <Celda>
                <NotaCargo cargoId={c.id} notas={c.notas} />
              </Celda>
              <Celda>
                <PagosCargo pagos={c.pagos} />
              </Celda>
              <Celda>
                {pagable && (
                  <Boton variante="secundario" onClick={() => setDialogo({ cargos: [aPagar(c)], modelo: c.propietario_modelo })}>
                    Registrar pago
                  </Boton>
                )}
              </Celda>
            </tr>
          )
        })}
      </Tabla>
      <RegistrarPagoDialog
        cargos={dialogo?.cargos ?? null}
        modelo={dialogo?.modelo ?? 'cobra_disa'}
        alCerrar={() => {
          setDialogo(null)
          setSeleccion([])
        }}
      />
    </div>
  )
}
