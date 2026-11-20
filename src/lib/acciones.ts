import { unstable_rethrow } from 'next/navigation'
import type { Errores } from '@/lib/validators/comun'

/** `advertencia`: la operación principal se hizo, pero algo secundario falló (se muestra al usuario). */
export type Resultado = { ok: true; id: string; advertencia?: string } | { ok: false; errores: Errores }

/** Error de regla de negocio: se lanza dentro de la transacción (la revierte) y se muestra en `campo`. */
export class ErrorNegocio extends Error {
  constructor(
    readonly campo: string,
    mensaje: string,
  ) {
    super(mensaje)
    this.name = 'ErrorNegocio'
  }
}

export function fallo(campo: string, mensaje: string): Resultado {
  return { ok: false, errores: { [campo]: mensaje } }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function esUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v)
}

const MENSAJES_PG: Record<string, string> = {
  '42501': 'No tienes permiso para esta operación',
  '23505': 'Ya existe un registro con esos datos',
  '23503': 'Un registro relacionado no existe',
  '23514': 'Algún dato está fuera de rango',
}

type Destino = [campo: string, mensaje: string]

/** Índices únicos con mensaje propio (constraint_name → campo y mensaje). */
const MENSAJES_UNICOS: Record<string, Destino> = {
  contratos_una_vigente_por_unidad: ['unidad_id', 'La unidad ya tiene un contrato vigente'],
  pagos_referencia_uq: ['referencia', 'Ya existe un pago con esa referencia'],
}

/** `raise exception 'CODIGO'` de las funciones de BD (P0001) → campo y mensaje. */
const MENSAJES_FUNCIONES: Record<string, Destino> = {
  SOLO_EQUIPO: ['_form', 'No tienes permiso para esta operación'],
  SOLO_NOTAS: ['_form', 'Sólo puedes editar las notas del cargo'],
  MONTO_INVALIDO: ['monto', 'El monto debe ser mayor a cero'],
  MONTO_EXCEDE_SALDO: ['monto', 'El monto excede el saldo de los cargos seleccionados'],
  CARGOS_REQUERIDOS: ['_form', 'Selecciona al menos un cargo'],
  CARGO_NO_ENCONTRADO: ['_form', 'El cargo no existe'],
  CARGOS_DE_VARIOS_PROPIETARIOS: ['_form', 'Los cargos seleccionados deben ser del mismo propietario'],
  CARGO_CON_PAGOS: ['_form', 'El cargo ya tiene pagos; cancélalos primero'],
  PAGO_NO_ENCONTRADO: ['_form', 'El pago no existe'],
  PAGO_CANCELADO: ['_form', 'El pago ya estaba cancelado'],
  MOTIVO_REQUERIDO: ['_form', 'Indica el motivo de la cancelación'],
  SOLO_ADMIN: ['_form', 'Sólo el administrador puede cerrar liquidaciones'],
  ESTATUS_INVALIDO: ['_form', 'La liquidación no está en el estado correcto para esta acción'],
  LIQUIDACION_CERRADA: ['_form', 'La liquidación ya está cerrada'],
  LIQUIDACION_NO_ENCONTRADA: ['_form', 'La liquidación no existe'],
  PERIODO_EN_CURSO: ['_form', 'No se puede cerrar un mes que aún no termina'],
  PERIODO_ANTERIOR_ABIERTO: ['_form', 'Hay un mes anterior sin cerrar para este propietario'],
  PROPIETARIO_NO_ENCONTRADO: ['_form', 'El propietario no existe'],
  DESCRIPCION_REQUERIDA: ['descripcion', 'Escribe la descripción'],
  GASTO_LIQUIDADO: ['_form', 'El gasto ya forma parte de una liquidación cerrada'],
  UNIDAD_DE_OTRO_INMUEBLE: ['unidadId', 'La unidad no pertenece a ese inmueble'],
  DOCUMENTO_DE_OTRO_PROPIETARIO: ['_form', 'El documento hace referencia a datos de otro propietario'],
  SOLO_METADATOS: ['_form', 'Sólo puedes cambiar el nombre, el tipo y la visibilidad del documento'],
}

function buscar(tabla: Record<string, Destino>, clave: unknown): Destino | undefined {
  return typeof clave === 'string' && Object.hasOwn(tabla, clave) ? tabla[clave] : undefined
}

/** Ejecuta la mutación y traduce errores de negocio y de Postgres (incl. RLS) a `Resultado`. */
export async function ejecutar(fn: () => Promise<string>): Promise<Resultado> {
  try {
    return { ok: true, id: await fn() }
  } catch (err) {
    unstable_rethrow(err)
    if (err instanceof ErrorNegocio) return fallo(err.campo, err.message)
    const { code, constraint_name, message } = err as { code?: unknown; constraint_name?: unknown; message?: unknown }
    const destino =
      (code === '23505' && buscar(MENSAJES_UNICOS, constraint_name)) ||
      (code === 'P0001' && buscar(MENSAJES_FUNCIONES, message))
    if (destino) return fallo(...destino)
    if (typeof code === 'string' && code in MENSAJES_PG) return fallo('_form', MENSAJES_PG[code])
    console.error(err)
    return fallo('_form', 'No se pudo guardar. Intenta de nuevo.')
  }
}
