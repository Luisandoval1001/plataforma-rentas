import { Encabezado, Pagina, Seccion } from '@/app/app/_components/Pagina'
import { Celda, Tabla } from '@/components/ui/Tabla'
import { requireRol } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import { listarUsuariosEquipo } from '@/lib/queries/usuarios'
import { BotonActivo } from './_components/BotonActivo'

async function Contenido() {
  const session = await requireRol('admin')
  const usuarios = await withSession(session, listarUsuariosEquipo)
  return (
    <>
      <Encabezado titulo="Usuarios del equipo" />
      <Seccion titulo="Equipo">
        <p className="text-sm text-gray-600">
          Desactivar quita el acceso de inmediato y cierra las sesiones abiertas. Los usuarios nuevos se dan de alta como
          indica la guía de despliegue (invitación en Supabase).
        </p>
        <Tabla columnas={['Nombre', 'Correo', 'Rol', 'Estado', '']} vacio="Sin usuarios del equipo">
          {usuarios.map((u) => (
            <tr key={u.id}>
              <Celda>{u.nombre}</Celda>
              <Celda>{u.email}</Celda>
              <Celda>{u.rol === 'admin' ? 'Administrador' : 'Equipo'}</Celda>
              <Celda>{u.activo ? 'Activo' : 'Desactivado'}</Celda>
              <Celda>{u.id !== session.usuarioId && <BotonActivo usuarioId={u.id} nombre={u.nombre} activo={u.activo} />}</Celda>
            </tr>
          ))}
        </Tabla>
      </Seccion>
    </>
  )
}

export default function Page() {
  return (
    <Pagina>
      <Contenido />
    </Pagina>
  )
}
