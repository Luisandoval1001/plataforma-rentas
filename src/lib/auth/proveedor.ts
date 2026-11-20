import { esDemo } from '@/lib/demo'

export type ProveedorAuth = 'local' | 'supabase'

/**
 * Proveedor de auth de AUTH_PROVIDER; falla si falta, es desconocido o es `local` en producción.
 * Única excepción: MODO_DEMO=1 (instalación de demostración con datos ficticios).
 */
export function proveedorAuth(): ProveedorAuth {
  const valor = process.env.AUTH_PROVIDER
  if (valor !== 'local' && valor !== 'supabase') throw new Error('AUTH_PROVIDER inválido')
  if (valor === 'local' && process.env.NODE_ENV === 'production' && !esDemo()) {
    throw new Error('AUTH_PROVIDER=local no se permite en producción')
  }
  return valor
}
