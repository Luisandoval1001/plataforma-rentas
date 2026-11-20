import Link from 'next/link'
import { notFound } from 'next/navigation'
import { activarContrato, renovarContrato, terminarContrato } from '@/app/app/_actions/contratos'
import { Datos, Encabezado, Pagina, Seccion } from '@/app/app/_components/Pagina'
import { Campo } from '@/components/ui/Campo'
import { Formulario } from '@/components/ui/Formulario'
import { esUuid } from '@/lib/acciones'
import { requireRol } from '@/lib/auth/session'
import { withSession } from '@/lib/db'
import { dinero, fecha, porcentaje } from '@/lib/formato'
import { obtenerContrato } from '@/lib/queries/contratos'
import { getFileUrl } from '@/lib/storage'
import { EstatusContrato } from '../_components/EstatusContrato'

const enlace = 'text-blue-700 underline'

async function Contenido({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireRol('admin', 'equipo')
  const { id } = await params
  if (!esUuid(id)) notFound()
  const c = await withSession(session, (sql) => obtenerContrato(sql, id))
  if (!c) notFound()
  const pdfUrl = c.pdf_path ? await getFileUrl(c.pdf_path) : null
  return (
    <>
      <Encabezado titulo={`Contrato · ${c.inmueble_nombre} · ${c.unidad_nombre}`} />
      <Seccion titulo="Datos">
        <Datos
          filas={[
            ['Estatus', <EstatusContrato key="e" estatus={c.estatus_calc} desde={c.pendiente_firma_desde} />],
            ['Inquilino', c.inquilino_nombre],
            ['Inmueble', <Link key="i" href={`/app/inmuebles/${c.inmueble_id}`} className={enlace}>{c.inmueble_nombre} · {c.unidad_nombre}</Link>],
            ['Propietario', <Link key="p" href={`/app/propietarios/${c.propietario_id}`} className={enlace}>{c.propietario_nombre}</Link>],
            ['Inicio', fecha(c.fecha_inicio)],
            ['Fin', fecha(c.fecha_fin)],
            ['Renta mensual pactada', dinero(c.renta_mensual)],
            ['Renta actual (con incremento anual)', dinero(c.renta_actual)],
            ['Día de pago', c.dia_pago],
            ['Depósito en garantía', dinero(c.deposito)],
            ['Incremento anual', porcentaje(c.incremento_anual_pct)],
            ['Se cobra desde', fecha(c.cargos_desde)],
            ['PDF', pdfUrl ? <a key="pdf" href={pdfUrl} target="_blank" rel="noreferrer" className={enlace}>Ver PDF</a> : 'Sin PDF'],
            ['Contrato anterior', c.contrato_origen_id ? <Link key="o" href={`/app/contratos/${c.contrato_origen_id}`} className={enlace}>Ver contrato anterior</Link> : null],
            ['Renovación', c.renovacion_id ? <Link key="r" href={`/app/contratos/${c.renovacion_id}`} className={enlace}>Ver renovación</Link> : null],
          ]}
        />
      </Seccion>
      {c.estatus === 'pendiente_firma' && (
        <Seccion titulo="Activar con el contrato firmado">
          <Formulario accion={activarContrato.bind(null, c.id)} textoBoton="Activar contrato">
            <Campo etiqueta="Contrato firmado (PDF)" name="pdf" type="file" accept="application/pdf" ayuda="PDF, hasta 4 MB" required />
          </Formulario>
        </Seccion>
      )}
      {c.estatus === 'vigente' && (
        <Seccion titulo="Acciones">
          <div className="flex flex-col gap-3 sm:flex-row">
            {!c.renovacion_id && (
              <Formulario accion={renovarContrato.bind(null, c.id)} textoBoton="Renovar" redirigirA="/app/contratos/:id" />
            )}
            <Formulario
              accion={terminarContrato.bind(null, c.id)}
              textoBoton="Terminar contrato"
              variante="peligro"
              confirmar="¿Terminar este contrato? Ya no se generarán cargos de renta."
            />
          </div>
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
