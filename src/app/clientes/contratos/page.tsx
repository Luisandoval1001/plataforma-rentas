import { dinero, fecha } from '@/lib/formato'
import { portalContratos } from '@/lib/queries/portal'
import { getFileUrl } from '@/lib/storage'
import { Datos, Grupo, Pagina, Tarjeta, Titulo, Vacio, enlace } from '../_components/Marco'
import { contextoPortal, porPropietario } from '../_lib/contexto'

const COLOR = {
  vigente: 'bg-green-50 text-green-800 border-green-200',
  por_vencer: 'bg-amber-50 text-amber-800 border-amber-200',
  vencido: 'bg-red-50 text-red-700 border-red-200',
  terminado: 'bg-gray-50 text-gray-700 border-gray-200',
  pendiente_firma: 'bg-amber-50 text-amber-800 border-amber-200',
} as const

/** Sólo un contrato en curso tiene próxima renovación. */
const RENOVABLE = new Set(['vigente', 'por_vencer'])

async function Contenido() {
  const { session, propietarios, t } = await contextoPortal()
  const cs = await portalContratos(session)
  const pdfs = await Promise.all(cs.map((c) => (c.pdf_path ? getFileUrl(c.pdf_path) : null)))
  const urlPdf = new Map(cs.map((c, i) => [c.contrato_id, pdfs[i]]))
  const grupos = porPropietario(propietarios, cs)
  return (
    <>
      <Titulo>{t('contratos.titulo')}</Titulo>
      {grupos.length === 0 && <Vacio>{t('contratos.vacio')}</Vacio>}
      {grupos.map((g) => (
        <Grupo key={g.propietario.id} nombre={g.propietario.nombre} mostrar={propietarios.length > 1}>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {g.filas.map((c) => {
              const pdf = urlPdf.get(c.contrato_id)
              return (
                <Tarjeta key={c.contrato_id} testId="contrato">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="font-semibold">
                      {c.inmueble_nombre} · {c.unidad_nombre}
                    </h2>
                    <span className={`rounded-full border px-2 py-0.5 text-sm ${COLOR[c.estatus_calc]}`}>
                      {t(`contrato.${c.estatus_calc}`)}
                    </span>
                  </div>
                  <Datos
                    filas={[
                      [t('contratos.inquilino'), c.inquilino_nombre ?? '—'],
                      [t('contratos.vigencia'), `${fecha(c.fecha_inicio)} – ${fecha(c.fecha_fin)}`],
                      [t('contratos.renta'), dinero(c.renta_actual)],
                      [t('contratos.deposito'), c.deposito == null ? '—' : dinero(c.deposito)],
                      [t('contratos.renovacion'), RENOVABLE.has(c.estatus_calc) ? fecha(c.fecha_fin) : '—'],
                    ]}
                  />
                  {pdf && (
                    <a href={pdf} target="_blank" rel="noreferrer" className={enlace}>
                      {t('contratos.verPdf')}
                    </a>
                  )}
                </Tarjeta>
              )
            })}
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
