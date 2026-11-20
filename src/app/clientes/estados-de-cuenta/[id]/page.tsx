import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { Celda, Tabla } from '@/components/ui/Tabla'
import { dinero, fecha } from '@/lib/formato'
import { nombreMes } from '@/lib/i18n'
import { portalLiquidacion } from '@/lib/queries/portal'
import { getFileUrl } from '@/lib/storage'
import { Datos, Pagina, Titulo, enlace } from '../../_components/Marco'
import { contextoPortal } from '../../_lib/contexto'

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section aria-label={titulo} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
      <h2 className="text-lg font-semibold">{titulo}</h2>
      {children}
    </section>
  )
}

async function Contenido({ params }: { params: Promise<{ id: string }> }) {
  const { session, idioma, t } = await contextoPortal()
  const l = await portalLiquidacion(session, (await params).id)
  if (!l) notFound()
  const [pdf, docUrls, comprobantes] = await Promise.all([
    l.pdf_path ? getFileUrl(l.pdf_path) : null,
    Promise.all(l.documentos.map((d) => getFileUrl(d.path))),
    Promise.all(l.lineas.map((x) => (x.comprobante_path ? getFileUrl(x.comprobante_path) : null))),
  ])
  const neto = Number(l.neto)
  return (
    <>
      <p>
        <Link href="/clientes/estados-de-cuenta" className={enlace}>
          {t('liquidacion.volver')}
        </Link>
      </p>
      <Titulo
        sub={
          l.estatus === 'pagada' && l.pago_fecha
            ? t('liquidacion.pagadaEl', { fecha: fecha(l.pago_fecha) })
            : t('liquidacion.cerrada')
        }
      >
        {t('liquidacion.titulo', { periodo: nombreMes(idioma, l.periodo) })}
      </Titulo>

      <Seccion titulo={t('liquidacion.totales')}>
        <Datos
          filas={[
            [t('liquidacion.cobrado'), dinero(l.cobrado)],
            [t('liquidacion.cobradoDisa'), dinero(l.cobrado_disa)],
            [t('liquidacion.comisionDisa'), dinero(l.comision)],
            [t('liquidacion.iva'), dinero(l.iva)],
            [t('liquidacion.gastosDisa'), dinero(l.gastos_disa)],
            [t('liquidacion.gastosPropietario'), dinero(l.gastos_propietario)],
            [t('liquidacion.ajustes'), dinero(l.ajustes)],
          ]}
        />
        <p className="flex flex-wrap items-baseline justify-between gap-2 border-t border-gray-200 pt-3 text-lg">
          <span>{neto >= 0 ? t('liquidacion.netoPropietario') : t('liquidacion.netoDisa')}</span>
          <span data-testid="neto" className="text-2xl font-bold tabular-nums">
            {dinero(l.neto)}
          </span>
        </p>
        {pdf && (
          <a href={pdf} target="_blank" rel="noreferrer" className={enlace}>
            {t('liquidacion.descargarPdf')}
          </a>
        )}
      </Seccion>

      <Seccion titulo={t('liquidacion.lineas')}>
        <Tabla
          columnas={[t('liquidacion.tipo'), t('liquidacion.descripcion'), t('liquidacion.monto')]}
          vacio={t('liquidacion.sinLineas')}
        >
          {l.lineas.map((x, i) => (
            <tr key={i}>
              <Celda>{t(`linea.${x.tipo}`)}</Celda>
              <Celda className="whitespace-normal">
                {x.descripcion}
                {comprobantes[i] && (
                  <>
                    {' · '}
                    <a href={comprobantes[i]} target="_blank" rel="noreferrer" className={enlace}>
                      {t('liquidacion.comprobante')}
                    </a>
                  </>
                )}
              </Celda>
              <Celda className="text-right tabular-nums">{dinero(x.monto)}</Celda>
            </tr>
          ))}
        </Tabla>
      </Seccion>

      {l.documentos.length > 0 && (
        <Seccion titulo={t('liquidacion.documentos')}>
          <ul className="space-y-2">
            {l.documentos.map((d, i) => (
              <li key={d.id} className="flex flex-wrap justify-between gap-2">
                <a href={docUrls[i]} target="_blank" rel="noreferrer" className={enlace}>
                  {d.nombre}
                </a>
                <span className="text-sm text-gray-600">{t(`documento.${d.tipo}`)}</span>
              </li>
            ))}
          </ul>
        </Seccion>
      )}
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
