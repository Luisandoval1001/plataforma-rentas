import Link from 'next/link'
import { dinero, fecha } from '@/lib/formato'
import { nombreMes } from '@/lib/i18n'
import { portalLiquidaciones } from '@/lib/queries/portal'
import { getFileUrl } from '@/lib/storage'
import { Grupo, Pagina, Tarjeta, Titulo, Vacio, enlace } from '../_components/Marco'
import { contextoPortal, porPropietario } from '../_lib/contexto'

async function Contenido() {
  const { session, propietarios, idioma, t } = await contextoPortal()
  const ls = await portalLiquidaciones(session)
  const pdfs = await Promise.all(ls.map((l) => (l.pdf_path ? getFileUrl(l.pdf_path) : null)))
  const urlPdf = new Map(ls.map((l, i) => [l.id, pdfs[i]]))
  const grupos = porPropietario(propietarios, ls)
  return (
    <>
      <Titulo>{t('liquidaciones.titulo')}</Titulo>
      {grupos.length === 0 && <Vacio>{t('liquidaciones.vacio')}</Vacio>}
      {grupos.map((g) => (
        <Grupo key={g.propietario.id} nombre={g.propietario.nombre} mostrar={propietarios.length > 1}>
          <ul className="space-y-3">
            {g.filas.map((l) => {
              const periodo = nombreMes(idioma, l.periodo)
              const pdf = urlPdf.get(l.id)
              return (
                <Tarjeta key={l.id} testId="liquidacion">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={`/clientes/estados-de-cuenta/${l.id}`} className={`text-lg font-semibold ${enlace}`}>
                      {periodo}
                    </Link>
                    <span className="text-sm text-gray-700">
                      {l.estatus === 'pagada' && l.pago_fecha
                        ? t('liquidacion.pagadaEl', { fecha: fecha(l.pago_fecha) })
                        : t('liquidacion.cerrada')}
                    </span>
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                    {(
                      [
                        ['liquidacion.cobrado', l.cobrado],
                        ['liquidacion.comision', Number(l.comision) + Number(l.iva)],
                        ['liquidacion.gastos', l.gastos_disa],
                        ['liquidacion.neto', l.neto],
                      ] as const
                    ).map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-gray-500">{t(k)}</dt>
                        <dd className={`tabular-nums ${k === 'liquidacion.neto' ? 'text-base font-bold' : 'font-medium'}`}>
                          {dinero(v)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {pdf && (
                    <a href={pdf} target="_blank" rel="noreferrer" className={enlace}>
                      {t('liquidacion.descargarPdf')}
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
