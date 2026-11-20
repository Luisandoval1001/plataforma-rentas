import type { Session } from '@/lib/auth/session'
import { correoContratoPorVencer } from '@/lib/avisos'
import { withSession } from '@/lib/db'
import { sendEmail } from '@/lib/email'

const SISTEMA: Session = {
  usuarioId: '00000000-0000-0000-0000-000000000001',
  email: 'sistema@local',
  rol: 'admin',
  propietarioIds: [],
}

type PorVencer = {
  id: string
  propietario_id: string
  lugar: string
  inquilino: string
  fecha_fin: string
  renta: string
  contacto_email: string
  idioma: 'es' | 'en'
}

/** Genera los cargos del mes de `hoy` y avisa (una sola vez) de los contratos por vencer. */
export async function ejecutarDiario(hoy: Date): Promise<{ cargosGenerados: number; avisosContrato: number }> {
  const periodo = `${hoy.getUTCFullYear()}-${String(hoy.getUTCMonth() + 1).padStart(2, '0')}-01`

  const cargosGenerados = await withSession(SISTEMA, async (sql) => {
    const [{ n }] = await sql<{ n: number }[]>`select generar_cargos_renta(${periodo}::date) as n`
    return n
  })

  const pendientes = await withSession(SISTEMA, (sql) => sql<PorVencer[]>`
    select c.id, c.propietario_id, i.nombre || ' ' || u.nombre as lugar,
           c.inquilino_nombre as inquilino, c.fecha_fin::text as fecha_fin,
           c.renta_actual::text as renta, p.contacto_email, p.idioma
    from v_contratos c
    join unidades u on u.id = c.unidad_id
    join inmuebles i on i.id = u.inmueble_id
    join propietarios p on p.id = c.propietario_id
    where c.estatus_calc = 'por_vencer'
      and not c.tiene_sucesor_vigente
      and p.avisos_contrato
      and coalesce(trim(p.contacto_email), '') <> ''
      and not exists (select 1 from avisos_enviados a where a.tipo = 'contrato_por_vencer' and a.referencia_id = c.id)
    order by c.fecha_fin, c.id`)

  let avisosContrato = 0
  for (const c of pendientes) {
    try {
      await sendEmail({
        to: c.contacto_email,
        ...correoContratoPorVencer({
          lugar: c.lugar, inquilino: c.inquilino ?? '', fechaFin: c.fecha_fin, renta: c.renta, idioma: c.idioma,
        }),
      })
      await withSession(SISTEMA, (sql) => sql`
        insert into avisos_enviados (propietario_id, tipo, referencia_id)
        values (${c.propietario_id}, 'contrato_por_vencer', ${c.id})
        on conflict (tipo, referencia_id) do nothing`)
      avisosContrato++
    } catch (err) {
      console.error('No se pudo enviar el aviso de contrato por vencer', c.id, err)
    }
  }
  return { cargosGenerados, avisosContrato }
}
