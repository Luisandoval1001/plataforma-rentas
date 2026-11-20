import { notFound } from 'next/navigation'
import { actualizarPropietario, invitarUsuarioPropietario } from '@/app/app/_actions/propietarios'
import { BotonActivo } from '@/app/app/usuarios/_components/BotonActivo'
import { Datos, Encabezado, Pagina, Seccion } from '@/app/app/_components/Pagina'
import { BotonEnlace } from '@/components/ui/Boton'
import { Campo } from '@/components/ui/Campo'
import { Formulario } from '@/components/ui/Formulario'
import { Celda, Tabla } from '@/components/ui/Tabla'
import { esUuid } from '@/lib/acciones'
import { requireRol } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import { porcentaje } from '@/lib/formato'
import { MODELO_TEXTO, obtenerPropietario, usuariosPortal } from '@/lib/queries/propietarios'
import { CamposPropietario } from '../_components/CamposPropietario'
import { EditarPropietario } from '../_components/EditarPropietario'

const siNo = (v: boolean) => (v ? 'Sí' : 'No')

async function Contenido({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRol('admin', 'equipo')
  const { id } = await params
  if (!esUuid(id)) notFound()
  const [p, usuarios] = await withSession(session, (sql) =>
    Promise.all([obtenerPropietario(sql, id), usuariosPortal(sql, id)]),
  )
  if (!p) notFound()
  const esAdmin = session.rol === 'admin'
  return (
    <>
      <Encabezado titulo={p.nombre}>
        <BotonEnlace href={`/app/propietarios/${p.id}/documentos`} variante="secundario">
          Documentos
        </BotonEnlace>
      </Encabezado>
      <Seccion titulo="Datos">
        <Datos
          filas={[
            ['RFC', p.rfc],
            ['Modelo de dinero', MODELO_TEXTO[p.modelo]],
            ['Comisión', porcentaje(p.comision_pct)],
            ['Cuenta (últimos 4)', p.cuenta_ultimos4],
            ['Correo', p.contacto_email],
            ['Teléfono', p.contacto_tel],
            ['Idioma', p.idioma === 'en' ? 'Inglés' : 'Español'],
            ['Recargo visible', siNo(p.recargo_visible)],
            ['Recargos del propietario', siNo(p.recargos_al_propietario)],
            ['Avisos de pago', siNo(p.avisos_pago)],
            ['Aviso de estado de cuenta', siNo(p.avisos_estado_cuenta)],
            ['Avisos de contratos', siNo(p.avisos_contrato)],
          ]}
        />
        {esAdmin && (
          <EditarPropietario accion={actualizarPropietario.bind(null, p.id)}>
            <CamposPropietario p={p} />
          </EditarPropietario>
        )}
      </Seccion>
      <Seccion titulo="Usuarios del portal">
        <Tabla columnas={esAdmin ? ['Nombre', 'Correo', 'Estado', ''] : ['Nombre', 'Correo', 'Estado']} vacio="Sin usuarios del portal">
          {usuarios.map((u) => (
            <tr key={u.id}>
              <Celda>{u.nombre}</Celda>
              <Celda>{u.email}</Celda>
              <Celda>{u.activo ? 'Activo' : 'Desactivado'}</Celda>
              {esAdmin && (
                <Celda>
                  <BotonActivo usuarioId={u.id} nombre={u.nombre} activo={u.activo} />
                </Celda>
              )}
            </tr>
          ))}
        </Tabla>
        {esAdmin && (
          <Formulario
            accion={invitarUsuarioPropietario.bind(null, p.id)}
            textoBoton="Invitar"
            mensajeExito="Usuario invitado"
            limpiar
          >
            <Campo etiqueta="Nombre del usuario" name="nombre" required />
            <Campo etiqueta="Correo del usuario" name="email" type="email" required />
          </Formulario>
        )}
      </Seccion>
    </>
  )
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Pagina>
      <Contenido params={params} />
    </Pagina>
  )
}
