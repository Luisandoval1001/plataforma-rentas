import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Encabezado, Pagina, Seccion } from '@/app/app/_components/Pagina'
import { Celda, Tabla } from '@/components/ui/Tabla'
import { esUuid } from '@/lib/acciones'
import { requireRol } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import { fecha } from '@/lib/formato'
import { documentosDePropietario } from '@/lib/queries/liquidaciones'
import { getFileUrl } from '@/lib/storage'
import { TIPO_DOCUMENTO_TEXTO } from '@/lib/validators/documento'
import { AccionesDocumento } from './_components/AccionesDocumento'
import { SubirDocumento } from './_components/SubirDocumento'

const enlace = 'text-blue-700 underline'

async function Contenido({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRol('admin', 'equipo')
  const { id } = await params
  if (!esUuid(id)) notFound()
  const datos = await withSession(session, async (sql) => {
    const [p] = await sql<{ nombre: string }[]>`select nombre from propietarios where id = ${id}`
    if (!p) return null
    const [unidades, liquidaciones] = await Promise.all([
      sql<{ id: string; nombre: string }[]>`
        select un.id, i.nombre || ' ' || un.nombre as nombre
        from unidades un join inmuebles i on i.id = un.inmueble_id
        where un.propietario_id = ${id} order by 2`,
      sql<{ id: string; nombre: string }[]>`
        select id, to_char(periodo, 'YYYY-MM') || ' (' || estatus || ')' as nombre
        from liquidaciones where propietario_id = ${id} order by periodo desc`,
    ])
    return { nombre: p.nombre, unidades: [...unidades], liquidaciones: [...liquidaciones] }
  })
  if (!datos) notFound()
  const docs = await documentosDePropietario(session, id)
  const urls = await Promise.all(docs.map((d) => getFileUrl(d.path)))
  return (
    <>
      <Encabezado titulo={`Documentos · ${datos.nombre}`} />
      <p>
        <Link href={`/app/propietarios/${id}`} className={enlace}>
          Volver al propietario
        </Link>
      </p>
      <Seccion titulo="Documentos">
        <Tabla columnas={['Nombre', 'Tipo', 'Unidad', 'Visible', 'Fecha', 'Archivo', '']} vacio="Sin documentos">
          {docs.map((d, i) => (
            <tr key={d.id}>
              <Celda>{d.nombre}</Celda>
              <Celda>{TIPO_DOCUMENTO_TEXTO[d.tipo]}</Celda>
              <Celda>{d.unidad_nombre ?? '—'}</Celda>
              <Celda>{d.visible_propietario ? 'Sí' : 'No'}</Celda>
              <Celda>{fecha(d.created_at.toISOString())}</Celda>
              <Celda>
                <a href={urls[i]} target="_blank" rel="noreferrer" className={enlace}>
                  {d.path.endsWith('.xml') ? 'XML' : 'Abrir'}
                </a>
              </Celda>
              <Celda>
                <AccionesDocumento doc={d} esAdmin={session.rol === 'admin'} />
              </Celda>
            </tr>
          ))}
        </Tabla>
      </Seccion>
      <Seccion titulo="Subir documento">
        <SubirDocumento propietarioId={id} unidades={datos.unidades} liquidaciones={datos.liquidaciones} />
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
