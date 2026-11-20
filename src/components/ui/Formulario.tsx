'use client'

import { useRouter } from 'next/navigation'
import { createContext, startTransition, use, useActionState, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Resultado } from '@/lib/acciones'
import { Alerta } from './Alerta'
import { Boton } from './Boton'
import { envioBloqueado } from './formulario-estado'

type Estado = { resultado: Resultado | null }

const ContextoFormulario = createContext<{ errores: Record<string, string>; pendiente: boolean }>({
  errores: {},
  pendiente: false,
})

export function useErrorCampo(nombre: string): string | undefined {
  return use(ContextoFormulario).errores[nombre]
}

/**
 * Formulario de una server action que devuelve `Resultado`. Errores por campo vía contexto
 * (los muestra `Campo`); `_form` arriba del botón. Éxito: navega a `redirigirA` (`:id` = id
 * devuelto) o refresca la página. No borra lo capturado cuando hay errores. Éxito con `advertencia`:
 * muestra el aviso y bloquea el botón hasta "Entendido", que limpia el formulario y llama `alExito`
 * (así un segundo clic no repite la operación, p. ej. un pago).
 */
export function Formulario({
  accion,
  children,
  textoBoton = 'Guardar',
  redirigirA,
  mensajeExito,
  alExito,
  limpiar = false,
  confirmar,
  variante = 'primario',
  className = 'space-y-4',
}: {
  accion: (formData: FormData) => Promise<Resultado>
  children?: ReactNode
  textoBoton?: string
  redirigirA?: string
  mensajeExito?: string | ((id: string) => string)
  /** Se llama tras un éxito (además de refrescar), p. ej. para cerrar un diálogo. */
  alExito?: (id: string) => void
  limpiar?: boolean
  confirmar?: string
  variante?: 'primario' | 'secundario' | 'peligro'
  className?: string
}) {
  const router = useRouter()
  const ref = useRef<HTMLFormElement>(null)
  // En ref: una función nueva en cada render no debe volver a disparar el efecto de éxito.
  const alExitoRef = useRef(alExito)
  useEffect(() => {
    alExitoRef.current = alExito
  })
  const [estado, despachar, pendiente] = useActionState(
    async (_: Estado, fd: FormData): Promise<Estado> => ({ resultado: await accion(fd) }),
    { resultado: null },
  )
  const r = estado.resultado
  const [descartado, setDescartado] = useState<Resultado | null>(null)
  const bloqueado = envioBloqueado(r, descartado)

  function entendido() {
    if (!r?.ok) return
    setDescartado(r)
    ref.current?.reset()
    alExitoRef.current?.(r.id)
  }

  useEffect(() => {
    if (!r?.ok) return
    if (r.advertencia) {
      // Se queda en el formulario para que la advertencia se lea (sin redirigir ni cerrar).
      router.refresh()
    } else if (redirigirA) {
      router.push(redirigirA.replace(':id', r.id))
    } else {
      if (limpiar) ref.current?.reset()
      router.refresh()
      alExitoRef.current?.(r.id)
    }
  }, [r, redirigirA, limpiar, router])

  const errores = r && !r.ok ? r.errores : {}
  return (
    <ContextoFormulario value={{ errores, pendiente }}>
      <form
        ref={ref}
        className={className}
        onSubmit={(e) => {
          e.preventDefault()
          if (bloqueado) return
          if (confirmar && !window.confirm(confirmar)) return
          const fd = new FormData(e.currentTarget)
          startTransition(() => despachar(fd))
        }}
      >
        {children}
        {errores._form && <Alerta tipo="error">{errores._form}</Alerta>}
        {bloqueado && r?.ok && (
          <Alerta tipo="advertencia">
            <p>{r.advertencia}</p>
            <Boton type="button" variante="secundario" onClick={entendido} className="mt-2">
              Entendido
            </Boton>
          </Alerta>
        )}
        {r?.ok && !r.advertencia && mensajeExito && !redirigirA && (
          <Alerta tipo="exito">{typeof mensajeExito === 'function' ? mensajeExito(r.id) : mensajeExito}</Alerta>
        )}
        <Boton type="submit" variante={variante} disabled={pendiente || bloqueado} className="w-full sm:w-auto">
          {pendiente ? 'Guardando…' : textoBoton}
        </Boton>
      </form>
    </ContextoFormulario>
  )
}
