export type Rol = 'admin' | 'equipo' | 'propietario'

export type Session = {
  usuarioId: string
  email: string
  rol: Rol
  propietarioIds: string[]
}
