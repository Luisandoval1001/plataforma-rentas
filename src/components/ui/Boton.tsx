import Link from 'next/link'
import type { ButtonHTMLAttributes, ComponentProps } from 'react'

type Variante = 'primario' | 'secundario' | 'peligro'

const ESTILOS: Record<Variante, string> = {
  primario: 'bg-blue-700 text-white hover:bg-blue-800 disabled:bg-blue-300',
  secundario: 'border border-gray-300 bg-white text-gray-900 hover:bg-gray-50 disabled:text-gray-400',
  peligro: 'border border-red-300 bg-white text-red-700 hover:bg-red-50 disabled:text-red-300',
}

export function claseBoton(variante: Variante = 'primario') {
  return `inline-flex min-h-11 items-center justify-center rounded-md px-4 py-2 text-base font-medium ${ESTILOS[variante]}`
}

export function Boton({
  variante = 'primario',
  className = '',
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  return <button type={type} className={`${claseBoton(variante)} ${className}`} {...props} />
}

export function BotonEnlace({
  variante = 'primario',
  className = '',
  ...props
}: ComponentProps<typeof Link> & { variante?: Variante }) {
  return <Link className={`${claseBoton(variante)} ${className}`} {...props} />
}
