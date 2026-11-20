import Link from 'next/link'
import { useId, type ReactNode } from 'react'
import { Encabezado, Pagina } from '@/app/app/_components/Pagina'
import { BotonEnlace } from '@/components/ui/Boton'
import { requireRol } from '@/lib/auth/session'
import { dinero, fecha, mes, mesIso } from '@/lib/formato'
import { tablero } from '@/lib/queries/tablero'

const enlace = 'block rounded-md px-2 py-2 hover:bg-gray-50'

/** Bloque del tablero: título con conteo y lista de renglones enlazados. */
function Bloque<T>({
  titulo,
  filas,
  vacio,
  renglon,
}: {
  titulo: string
  filas: T[]
  vacio: string
  renglon: (f: T) => { key: string; href: string; contenido: ReactNode }
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
      <h2 id={id} className="flex items-baseline justify-between gap-3 text-lg font-semibold">
        <span>{titulo}</span>
        <span data-testid="conteo" className="text-3xl font-bold tabular-nums">
          {filas.length}
        </span>
      </h2>
      {filas.length === 0 ? (
        <p className="text-gray-500">{vacio}</p>
      ) : (
        <ul className="max-h-96 divide-y divide-gray-100 overflow-y-auto">
          {filas.map((f) => {
            const r = renglon(f)
            return (
              <li key={r.key}>
                <Link href={r.href} className={enlace}>
                  {r.contenido}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

const Linea = ({ izquierda, derecha, abajo }: { izquierda: ReactNode; derecha: ReactNode; abajo?: ReactNode }) => (
  <>
    <div className="flex justify-between gap-3">
      <span className="font-medium">{izquierda}</span>
      <span className="whitespace-nowrap">{derecha}</span>
    </div>
    {abajo && <div className="text-sm text-gray-600">{abajo}</div>}
  </>
)

async function Contenido() {
  const session = await requireRol('admin', 'equipo')
  const t = await tablero(session)
  return (
    <>
      <Encabezado titulo="Tablero del día">
        {session.rol === 'admin' && (
          <BotonEnlace href="/app/usuarios" variante="secundario">
            Usuarios del equipo
          </BotonEnlace>
        )}
      </Encabezado>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Bloque
          titulo="Vencidos"
          filas={t.vencidos}
          vacio="Sin cargos vencidos"
          renglon={(v) => ({
            key: v.id,
            href: `/app/cobranza?periodo=${mesIso(v.periodo)}&estatus=vencido&cobrador=todos`,
            contenido: (
              <Linea
                izquierda={`${v.inmueble_nombre} · ${v.unidad_nombre}`}
                derecha={dinero(v.saldo)}
                abajo={`${v.inquilino_nombre} · ${mes(v.periodo)} · ${v.dias_atraso} días`}
              />
            ),
          })}
        />
        <Bloque
          titulo="Pagos de hoy"
          filas={t.pagosHoy}
          vacio="Aún no hay pagos registrados hoy"
          renglon={(p) => ({
            key: p.id,
            href: '/app/cobranza?cobrador=todos',
            contenido: (
              <Linea
                izquierda={p.lugares}
                derecha={dinero(p.monto)}
                abajo={[p.propietario_nombre, p.metodo, p.referencia].filter(Boolean).join(' · ')}
              />
            ),
          })}
        />
        <Bloque
          titulo="Contratos por vencer"
          filas={t.contratosPorVencer}
          vacio="Ningún contrato vence en los próximos 60 días"
          renglon={(c) => ({
            key: c.id,
            href: `/app/contratos/${c.id}`,
            contenido: (
              <Linea izquierda={`${c.inmueble_nombre} · ${c.unidad_nombre}`} derecha={fecha(c.fecha_fin)} abajo={c.inquilino_nombre} />
            ),
          })}
        />
        <Bloque
          titulo="Liquidaciones pendientes del mes anterior"
          filas={t.liquidacionesPendientes}
          vacio="Todas las liquidaciones del mes anterior están cerradas"
          renglon={(l) => ({
            key: l.propietario_id,
            href: '/app/liquidaciones',
            contenido: <Linea izquierda={l.nombre} derecha={l.estatus === 'borrador' ? 'en borrador' : 'sin liquidación'} />,
          })}
        />
      </div>
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
