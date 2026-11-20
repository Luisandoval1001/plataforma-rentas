import Link from 'next/link'
import { notFound } from 'next/navigation'
import { actualizarInmueble } from '@/app/app/_actions/inmuebles'
import { crearUnidad } from '@/app/app/_actions/unidades'
import { Datos, Encabezado, Pagina, Seccion } from '@/app/app/_components/Pagina'
import { EstatusContrato } from '@/app/app/contratos/_components/EstatusContrato'
import { BotonEnlace } from '@/components/ui/Boton'
import { Campo } from '@/components/ui/Campo'
import { Formulario } from '@/components/ui/Formulario'
import { Celda, Tabla } from '@/components/ui/Tabla'
import { esUuid } from '@/lib/acciones'
import { requireRol } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import { dinero } from '@/lib/formato'
import { cobradores, obtenerInmueble, unidadesConContrato } from '@/lib/queries/inmuebles'
import { CamposInmueble, textoTipo } from '../_components/CamposInmueble'

async function Contenido({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRol('admin', 'equipo')
  const { id } = await params
  if (!esUuid(id)) notFound()
  const [inmueble, unidades, usuarios] = await withSession(session, (sql) =>
    Promise.all([obtenerInmueble(sql, id), unidadesConContrato(sql, id), cobradores(sql)]),
  )
  if (!inmueble) notFound()
  return (
    <>
      <Encabezado titulo={inmueble.nombre} />
      <Seccion titulo="Datos">
        <Datos
          filas={[
            ['Propietario', <Link key="p" href={`/app/propietarios/${inmueble.propietario_id}`} className="text-blue-700 underline">{inmueble.propietario_nombre}</Link>],
            ['Dirección', inmueble.direccion],
            ['Tipo', textoTipo(inmueble.tipo)],
            ['Cobrador', inmueble.cobrador_nombre ?? 'Sin asignar'],
          ]}
        />
      </Seccion>
      <Seccion titulo="Unidades">
        <Tabla columnas={['Unidad', 'Inquilino', 'Renta', 'Estatus', '']} vacio="Sin unidades">
          {unidades.map((u) => (
            <tr key={u.id}>
              <Celda>{u.nombre}</Celda>
              <Celda>{u.inquilino_nombre ?? '—'}</Celda>
              <Celda>{dinero(u.renta_mensual)}</Celda>
              <Celda>
                {u.estatus_calc ? <EstatusContrato estatus={u.estatus_calc} desde={u.pendiente_firma_desde} /> : 'Disponible'}
              </Celda>
              <Celda>
                {u.contrato_id ? (
                  <Link href={`/app/contratos/${u.contrato_id}`} className="text-blue-700 underline">
                    Ver contrato
                  </Link>
                ) : (
                  <Link href={`/app/contratos/nuevo?unidad=${u.id}`} className="text-blue-700 underline">
                    Nuevo contrato
                  </Link>
                )}
              </Celda>
            </tr>
          ))}
        </Tabla>
        <Formulario accion={crearUnidad.bind(null, inmueble.id)} textoBoton="Agregar unidad" limpiar>
          <Campo etiqueta="Nombre de la unidad" name="nombre" placeholder="p. ej. 407 o Local A" required />
        </Formulario>
      </Seccion>
      <Seccion titulo="Editar inmueble">
        <Formulario accion={actualizarInmueble.bind(null, inmueble.id)} textoBoton="Guardar inmueble" mensajeExito="Guardado">
          <CamposInmueble i={inmueble} cobradores={usuarios.map((u) => ({ valor: u.id, texto: u.nombre }))} />
        </Formulario>
      </Seccion>
      <BotonEnlace href="/app/inmuebles" variante="secundario">
        Volver a inmuebles
      </BotonEnlace>
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
