import type { Sql } from './tipos'

export type UsuarioEquipo = { id: string; nombre: string; email: string; rol: 'admin' | 'equipo'; activo: boolean }

/** Usuarios del equipo (admin y equipo), sin el usuario sistema del cron y la carga inicial. */
export function listarUsuariosEquipo(sql: Sql) {
  return sql<UsuarioEquipo[]>`
    select id, nombre, email, rol, activo from usuarios
    where rol in ('admin', 'equipo') and id <> '00000000-0000-0000-0000-000000000001'
    order by rol, email`
}
