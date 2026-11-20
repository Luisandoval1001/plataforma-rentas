import { fecha } from '@/lib/formato'
import { portalDocumentos } from '@/lib/queries/portal'
import { getFileUrl } from '@/lib/storage'
import { Grupo, Pagina, Tarjeta, Titulo, Vacio, enlace } from '../_components/Marco'
import { contextoPortal, porPropietario } from '../_lib/contexto'

async function Contenido() {
  const { session, propietarios, t } = await contextoPortal()
  const docs = await portalDocumentos(session)
  const urls = await Promise.all(docs.map((d) => getFileUrl(d.path)))
  const url = new Map(docs.map((d, i) => [d.id, urls[i]]))
  const grupos = porPropietario(propietarios, docs)
  return (
    <>
      <Titulo>{t('documentos.titulo')}</Titulo>
      {grupos.length === 0 && <Vacio>{t('documentos.vacio')}</Vacio>}
      {grupos.map((g) => (
        <Grupo key={g.propietario.id} nombre={g.propietario.nombre} mostrar={propietarios.length > 1}>
          <ul className="space-y-2">
            {g.filas.map((d) => (
              <Tarjeta key={d.id} testId="documento">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <a href={url.get(d.id)} target="_blank" rel="noreferrer" className={`font-medium ${enlace}`}>
                    {d.nombre}
                  </a>
                  <span className="text-sm text-gray-600">
                    {t(`documento.${d.tipo}`)} · {fecha(d.fecha)}
                  </span>
                </div>
              </Tarjeta>
            ))}
          </ul>
        </Grupo>
      ))}
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
