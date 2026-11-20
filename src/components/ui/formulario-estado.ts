import type { Resultado } from '@/lib/acciones'

/**
 * Tras un éxito con `advertencia` (la operación principal ya se hizo) el formulario no debe volver a
 * enviarse: repetirlo duplicaría, p. ej., un pago. Queda bloqueado hasta que el usuario lo descarta
 * con "Entendido" (`descartado` = ese mismo resultado).
 */
export function envioBloqueado(r: Resultado | null, descartado: Resultado | null): boolean {
  return r !== null && r.ok && Boolean(r.advertencia) && r !== descartado
}
