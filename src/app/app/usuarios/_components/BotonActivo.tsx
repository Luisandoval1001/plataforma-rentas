import { desactivarUsuario, reactivarUsuario } from '@/app/app/_actions/usuarios'
import { Formulario } from '@/components/ui/Formulario'

/** Desactivar (con confirmación) o reactivar un usuario. Sólo se muestra al admin. */
export function BotonActivo({ usuarioId, nombre, activo }: { usuarioId: string; nombre: string; activo: boolean }) {
  return activo ? (
    <Formulario
      accion={desactivarUsuario.bind(null, usuarioId)}
      textoBoton="Desactivar"
      variante="peligro"
      confirmar={`¿Desactivar a ${nombre}? Pierde el acceso de inmediato y se cierran sus sesiones.`}
      className="space-y-2"
    />
  ) : (
    <Formulario accion={reactivarUsuario.bind(null, usuarioId)} textoBoton="Reactivar" variante="secundario" className="space-y-2" />
  )
}
