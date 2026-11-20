import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Datos, Encabezado, Pagina, Seccion } from '@/app/app/_components/Pagina'
import { Boton } from '@/components/ui/Boton'
import { Celda, Tabla } from '@/components/ui/Tabla'
import { requireRol } from '@/lib/auth/session'
import { dinero, fecha, hoyIso, porcentaje } from '@/lib/formato'
import { documentosDePropietario, liquidacionDetalle } from '@/lib/queries/liquidaciones'
import { MODELO_TEXTO } from '@/lib/queries/propietarios'
import { getFileUrl } from '@/lib/storage'
import { TIPO_DOCUMENTO_TEXTO } from '@/lib/validators/documento'
import { Cerrar, Preparar, RegenerarPdf, RegistrarAjuste } from '../_components/Acciones'
import { EstatusLiquidacion } from '../_components/EstatusLiquidacion'
import { RegistrarPago } from '../_components/RegistrarPago'

const TIPO_LINEA: Record<string, string> = {
  cobro: 'Cobro',
  gasto_disa: 'Gasto DISA',
  gasto_propietario: 'Gasto propietario',
  ajuste: 'Ajuste',
}

const enlace = 'text-blue-700 underline'

async function Contenido({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRol('admin', 'equipo')
  const { id } = await params
  const l = await liquidacionDetalle(session, id)
  if (!l) notFound()
  const esAdmin = session.rol === 'admin'
  const docs = await documentosDePropietario(session, l.propietario_id, { liquidacionId: l.id })
  const [pdfUrl, comprobanteUrl, docUrls] = await Promise.all([
    l.pdf_path ? getFileUrl(l.pdf_path) : null,
    l.pago_comprobante_path ? getFileUrl(l.pago_comprobante_path) : null,
    Promise.all(docs.map((d) => getFileUrl(d.path))),
  ])
  const neto = Number(l.neto)
  return (
    <>
      <Encabezado titulo={`Liquidación ${l.propietario.nombre} · ${l.periodo}`}>
        <EstatusLiquidacion estatus={l.estatus} />
      </Encabezado>
      <p>
        <Link href={`/app/liquidaciones?periodo=${l.periodo}`} className={enlace}>
          Volver a liquidaciones
        </Link>
      </p>

      <Seccion titulo="Totales">
        <Datos
          filas={[
            ['Modelo', MODELO_TEXTO[l.modelo]],
            ['Comisión', porcentaje(l.comision_pct)],
            ['Cobrado', dinero(l.cobrado)],
            ['Cobrado en cuenta DISA', dinero(l.cobrado_disa)],
            ['Comisión DISA', dinero(l.comision)],
            ['IVA 16%', dinero(l.iva)],
            ['Gastos DISA', dinero(l.gastos_disa)],
            ['Gastos del propietario', dinero(l.gastos_propietario)],
            ['Ajustes', dinero(l.ajustes)],
          ]}
        />
        <p className="text-lg">
          {neto >= 0 ? 'Neto a favor del propietario' : 'Saldo a favor de DISA'}:{' '}
          <span data-testid="neto" className="font-semibold">
            {dinero(l.neto)}
          </span>
        </p>
      </Seccion>

      <Seccion titulo="Acciones">
        {l.estatus === 'borrador' && (
          <div className="flex flex-wrap items-start gap-3">
            <Preparar propietarioId={l.propietario_id} periodo={l.periodo} texto="Volver a preparar" />
            {esAdmin ? (
              <Cerrar id={l.id} />
            ) : (
              <div className="space-y-1">
                <Boton disabled>Cerrar liquidación</Boton>
                <p className="text-sm text-gray-600">Sólo el administrador puede cerrar liquidaciones.</p>
              </div>
            )}
          </div>
        )}
        {l.estatus !== 'borrador' && (
          <div className="flex flex-wrap items-start gap-3">
            {pdfUrl && (
              <a href={pdfUrl} target="_blank" rel="noreferrer" className={enlace}>
                Ver PDF
              </a>
            )}
            <RegenerarPdf id={l.id} />
          </div>
        )}
      </Seccion>

      {l.estatus === 'cerrada' && (
        <Seccion titulo="Registrar pago">
          <RegistrarPago id={l.id} hoy={hoyIso()} />
        </Seccion>
      )}
      {l.estatus === 'pagada' && (
        <Seccion titulo="Pago">
          <Datos
            filas={[
              ['Fecha', fecha(l.pago_fecha)],
              ['Referencia', l.pago_referencia || '—'],
              [
                'Comprobante',
                comprobanteUrl ? (
                  <a href={comprobanteUrl} target="_blank" rel="noreferrer" className={enlace}>
                    Ver
                  </a>
                ) : (
                  '—'
                ),
              ],
            ]}
          />
        </Seccion>
      )}

      <Seccion titulo="Líneas">
        <Tabla columnas={['Tipo', 'Descripción', 'Monto']} vacio="Sin movimientos en el periodo">
          {l.lineas.map((x) => (
            <tr key={x.id}>
              <Celda>{TIPO_LINEA[x.tipo] ?? x.tipo}</Celda>
              <Celda className="whitespace-normal">{x.descripcion}</Celda>
              <Celda className="text-right">{dinero(x.monto)}</Celda>
            </tr>
          ))}
        </Tabla>
      </Seccion>

      <Seccion titulo="Documentos">
        <Tabla columnas={['Nombre', 'Tipo', 'Archivo']} vacio="Sin documentos">
          {docs.map((d, i) => (
            <tr key={d.id}>
              <Celda>{d.nombre}</Celda>
              <Celda>{TIPO_DOCUMENTO_TEXTO[d.tipo]}</Celda>
              <Celda>
                <a href={docUrls[i]} target="_blank" rel="noreferrer" className={enlace}>
                  Abrir
                </a>
              </Celda>
            </tr>
          ))}
        </Tabla>
        <Link href={`/app/propietarios/${l.propietario_id}/documentos`} className={enlace}>
          Todos los documentos del propietario
        </Link>
      </Seccion>

      {esAdmin && (
        <Seccion titulo="Registrar ajuste">
          <p className="text-sm text-gray-600">
            Corrección manual para {l.propietario.nombre}: entra en su siguiente liquidación que se prepare o cierre.
          </p>
          <RegistrarAjuste propietarioId={l.propietario_id} />
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
