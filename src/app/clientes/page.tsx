import { dinero, fecha, mesActualIso } from '@/lib/formato'
import { nombreMes } from '@/lib/i18n'
import { portalResumen, type PortalCargo, type PortalUnidad, type Totales } from '@/lib/queries/portal'
import { Grupo, Pagina, Tarjeta, Titulo, Vacio } from './_components/Marco'
import { Semaforo } from './_components/Semaforo'
import { contextoPortal } from './_lib/contexto'

type Tr = Awaited<ReturnType<typeof contextoPortal>>['t']

const COLOR_TOTAL: Record<keyof Totales, string> = {
  esperado: 'text-gray-900',
  cobrado: 'text-green-700',
  pendiente: 'text-amber-700',
  vencido: 'text-red-700',
}

function Totales({ totales, t }: { totales: Totales; t: Tr }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {(Object.keys(COLOR_TOTAL) as (keyof Totales)[]).map((k) => (
        <div key={k} className="rounded-lg border border-gray-200 bg-white p-3">
          <dt className="text-sm text-gray-600">{t(`resumen.${k}`)}</dt>
          <dd data-testid={`total-${k}`} className={`text-xl font-bold tabular-nums sm:text-2xl ${COLOR_TOTAL[k]}`}>
            {dinero(totales[k])}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** Un renglón por cargo del mes: semáforo, detalle (fecha o atraso) y monto (pagado o por cobrar). */
function Cargo({ c, t }: { c: PortalCargo; t: Tr }) {
  const ddmm = fecha(c.fecha_limite).slice(0, 5)
  const detalle =
    c.estatus === 'pagado'
      ? c.ultimo_pago_fecha && t('resumen.pagadoEl', { fecha: fecha(c.ultimo_pago_fecha) })
      : c.estatus === 'vencido'
        ? c.dias_atraso === 1
          ? t('resumen.diaAtraso')
          : t('resumen.diasAtraso', { n: c.dias_atraso })
        : t('resumen.venceEl', { fecha: ddmm })
  return (
    <li className="flex items-start justify-between gap-3 py-2">
      <div className="space-y-0.5">
        <Semaforo estatus={c.estatus} etiqueta={t(`estatus.${c.estatus}`)} />
        <p className="text-sm text-gray-600">
          {c.tipo !== 'renta' && `${t(`cargo.${c.tipo}`)} · `}
          {detalle}
        </p>
      </div>
      <span className="whitespace-nowrap text-lg font-semibold tabular-nums">
        {dinero(c.estatus === 'pagado' ? c.monto : c.saldo)}
      </span>
    </li>
  )
}

function Unidad({ u, t }: { u: PortalUnidad; t: Tr }) {
  return (
    <Tarjeta testId="unidad">
      <div>
        <h3 className="font-semibold">
          {u.inmueble_nombre} · {u.unidad_nombre}
        </h3>
        <p className="text-sm text-gray-600">{u.inquilino_nombre ?? t('resumen.sinInquilino')}</p>
      </div>
      {u.cargos.length === 0 ? (
        <p className="text-gray-500">{t('resumen.sinCargo')}</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {u.cargos.map((c) => (
            <Cargo key={c.cargo_id} c={c} t={t} />
          ))}
        </ul>
      )}
    </Tarjeta>
  )
}

async function Contenido() {
  const { session, idioma, t } = await contextoPortal()
  const grupos = await portalResumen(session)
  return (
    <>
      <Titulo sub={nombreMes(idioma, mesActualIso())}>{t('resumen.titulo')}</Titulo>
      {grupos.length === 0 && <Vacio>{t('resumen.sinUnidades')}</Vacio>}
      {grupos.map((g) => (
        <Grupo key={g.propietario.id} nombre={g.propietario.nombre} mostrar={grupos.length > 1}>
          <Totales totales={g.totales} t={t} />
          <h2 className="text-lg font-semibold">{t('resumen.unidades')}</h2>
          {g.unidades.length === 0 ? (
            <Vacio>{t('resumen.sinUnidades')}</Vacio>
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {g.unidades.map((u) => (
                <Unidad key={u.unidad_id} u={u} t={t} />
              ))}
            </ul>
          )}
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
