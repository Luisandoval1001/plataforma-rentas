'use client'

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { useErrorCampo } from './Formulario'

const CONTROL =
  'block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-base focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 aria-invalid:border-red-500'

function Envoltura({ id, etiqueta, error, ayuda, children }: {
  id: string
  etiqueta: string
  error?: string
  ayuda?: string
  children: ReactNode
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-gray-800">
        {etiqueta}
      </label>
      {children}
      {ayuda && !error && <p className="text-sm text-gray-500">{ayuda}</p>}
      {error && (
        <p id={`${id}-error`} className="text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}

/** Input con etiqueta y error del campo (`name`) tomado del Formulario. */
export function Campo({
  etiqueta,
  name,
  ayuda,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; name: string; ayuda?: string }) {
  const id = useId()
  const error = useErrorCampo(name)
  return (
    <Envoltura id={id} etiqueta={etiqueta} error={error} ayuda={ayuda}>
      <input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={CONTROL}
        {...props}
      />
    </Envoltura>
  )
}

export type Opcion = { valor: string; texto: string }

export function CampoSelect({
  etiqueta,
  name,
  opciones,
  vacio,
  ayuda,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  etiqueta: string
  name: string
  opciones: Opcion[]
  vacio?: string
  ayuda?: string
}) {
  const id = useId()
  const error = useErrorCampo(name)
  return (
    <Envoltura id={id} etiqueta={etiqueta} error={error} ayuda={ayuda}>
      <select
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={CONTROL}
        {...props}
      >
        {vacio !== undefined && <option value="">{vacio}</option>}
        {opciones.map((o) => (
          <option key={o.valor} value={o.valor}>
            {o.texto}
          </option>
        ))}
      </select>
    </Envoltura>
  )
}

export function CampoCasilla({
  etiqueta,
  name,
  defaultChecked,
}: {
  etiqueta: string
  name: string
  defaultChecked?: boolean
}) {
  const id = useId()
  return (
    <div className="flex min-h-11 items-center gap-3">
      <input id={id} type="checkbox" name={name} defaultChecked={defaultChecked} className="h-5 w-5" />
      <label htmlFor={id} className="text-base text-gray-800">
        {etiqueta}
      </label>
    </div>
  )
}
