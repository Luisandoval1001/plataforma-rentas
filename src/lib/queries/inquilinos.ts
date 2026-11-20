import type { InquilinoDatos } from '@/lib/validators/inquilino'
import type { Sql } from './tipos'

export async function insertarInquilino(sql: Sql, datos: InquilinoDatos): Promise<string> {
  const [r] = await sql<{ id: string }[]>`insert into inquilinos ${sql(datos)} returning id`
  return r.id
}

export function opcionesInquilinos(sql: Sql) {
  return sql<{ id: string; nombre: string }[]>`select id, nombre from inquilinos order by nombre`
}
