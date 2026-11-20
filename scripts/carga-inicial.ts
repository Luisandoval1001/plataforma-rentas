/**
 * Carga inicial del piloto desde CSV (UTF-8, encabezado en español).
 * Uso: npx tsx scripts/carga-inicial.ts <dir> <YYYY-MM-DD>
 * Todo ocurre en UNA transacción como usuario sistema; idempotente por `ref_carga`.
 * Los saldos iniciales se cargan como cargos tipo 'renta' del mes al que pertenecen
 * (no se cargan pagos históricos, sólo saldos abiertos). contratos.csv admite la columna opcional
 * primer_periodo_cargo (YYYY-MM): primer mes que el sistema cobra (contratos.cargos_desde).
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ZodType } from 'zod'
import type { Session } from '../src/lib/auth/session'
import { closeSql, withSession } from '../src/lib/db'
import { parseCsv } from './carga/csv'
import * as esquemas from './carga/esquemas'

const SISTEMA: Session = {
  usuarioId: '00000000-0000-0000-0000-000000000001',
  email: 'sistema@local',
  rol: 'admin',
  propietarioIds: [],
}

export type Conteos = {
  propietarios: number; inmuebles: number; unidades: number
  inquilinos: number; contratos: number; saldos: number
}
type Fila<T> = { linea: number; d: T }
type Sql = Parameters<Parameters<typeof withSession>[1]>[0]

async function leer<T>(dir: string, nombre: string, esquema: ZodType<T>): Promise<Fila<T>[]> {
  const archivo = `${nombre}.csv`
  let texto: string
  try {
    texto = await readFile(join(dir, archivo), 'utf8')
  } catch {
    throw new Error(`${archivo}: no se pudo leer el archivo en ${dir}`)
  }
  try {
    return parseCsv(texto).map(({ linea, valores }) => {
      const r = esquema.safeParse(valores)
      if (!r.success) {
        const i = r.error.issues[0]
        throw new Error(`línea ${linea}: ${i.path.join('.') || 'fila'}: ${i.message}`)
      }
      return { linea, d: r.data }
    })
  } catch (e) {
    throw new Error(`${archivo} ${(e as Error).message}`)
  }
}

/** Resuelve una referencia a su id; si no existe, falla nombrando archivo, línea y referencia. */
async function id(sql: Sql, tabla: string, ref: string, archivo: string, linea: number, campo: string) {
  const [r] = await sql`select id from ${sql(tabla)} where ref_carga = ${ref}`
  if (!r) throw new Error(`${archivo}.csv línea ${linea}: ${campo} "${ref}" no existe`)
  return r.id as string
}

/** Inserta fila por fila; devuelve cuántas se insertaron realmente (las ya cargadas no cuentan). */
async function cargar<T>(
  nombre: string, filas: Fila<T>[],
  insertar: (f: Fila<T>) => Promise<readonly unknown[]>,
): Promise<number> {
  let n = 0
  for (const f of filas) {
    try {
      n += (await insertar(f)).length
    } catch (e) {
      const msg = (e as Error).message
      throw new Error(msg.startsWith(`${nombre}.csv`) ? msg : `${nombre}.csv línea ${f.linea}: ${msg}`)
    }
  }
  return n
}

export async function cargarInicial(dir: string, fechaArranque: string): Promise<Conteos> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaArranque) || Number.isNaN(Date.parse(fechaArranque))) {
    throw new Error(`fechaArranque inválida: "${fechaArranque}" (YYYY-MM-DD)`)
  }
  const p = await leer(dir, 'propietarios', esquemas.propietarios)
  const im = await leer(dir, 'inmuebles', esquemas.inmuebles)
  const un = await leer(dir, 'unidades', esquemas.unidades)
  const iq = await leer(dir, 'inquilinos', esquemas.inquilinos)
  const co = await leer(dir, 'contratos', esquemas.contratos)
  const sa = await leer(dir, 'saldos', esquemas.saldos)
  for (const s of sa) {
    if (s.d.periodo > fechaArranque.slice(0, 7)) {
      throw new Error(`saldos.csv línea ${s.linea}: periodo ${s.d.periodo} posterior al mes de arranque (${fechaArranque.slice(0, 7)})`)
    }
  }

  return withSession(SISTEMA, async (sql) => ({
    propietarios: await cargar('propietarios', p, async ({ d }) => sql`
      insert into propietarios (ref_carga, nombre, rfc, modelo, comision_pct, contacto_email, contacto_tel, idioma, recargo_visible, recargos_al_propietario)
      values (${d.ref}, ${d.nombre}, ${d.rfc}, ${d.modelo}, ${d.comision_pct}, ${d.contacto_email}, ${d.contacto_tel}, ${d.idioma}, ${d.recargo_visible}, ${d.recargos_al_propietario})
      on conflict (ref_carga) do nothing returning id`),
    inmuebles: await cargar('inmuebles', im, async ({ linea, d }) => {
      const propietario = await id(sql, 'propietarios', d.propietario_ref, 'inmuebles', linea, 'propietario_ref')
      return sql`insert into inmuebles (ref_carga, propietario_id, nombre, direccion, tipo)
        values (${d.ref}, ${propietario}, ${d.nombre}, ${d.direccion}, ${d.tipo})
        on conflict (ref_carga) do nothing returning id`
    }),
    unidades: await cargar('unidades', un, async ({ linea, d }) => {
      const inmueble = await id(sql, 'inmuebles', d.inmueble_ref, 'unidades', linea, 'inmueble_ref')
      return sql`insert into unidades (ref_carga, inmueble_id, nombre) values (${d.ref}, ${inmueble}, ${d.nombre})
        on conflict (ref_carga) do nothing returning id`
    }),
    inquilinos: await cargar('inquilinos', iq, async ({ d }) => sql`
      insert into inquilinos (ref_carga, nombre, email, telefono, rfc)
      values (${d.ref}, ${d.nombre}, ${d.email}, ${d.telefono}, ${d.rfc})
      on conflict (ref_carga) do nothing returning id`),
    contratos: await cargar('contratos', co, async ({ linea, d }) => {
      const unidad = await id(sql, 'unidades', d.unidad_ref, 'contratos', linea, 'unidad_ref')
      const inquilino = await id(sql, 'inquilinos', d.inquilino_ref, 'contratos', linea, 'inquilino_ref')
      // cargos_desde: primer día de primer_periodo_cargo (sin bajar de fecha_inicio); nulo → fecha_inicio (trigger).
      const desde = d.primer_periodo_cargo ? `${d.primer_periodo_cargo}-01` : null
      return sql`insert into contratos (ref_carga, unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago, deposito, incremento_anual_pct, estatus, cargos_desde)
        values (${d.ref}, ${unidad}, ${inquilino}, ${d.fecha_inicio}, ${d.fecha_fin}, ${d.renta_mensual}, ${d.dia_pago}, ${d.deposito}, ${d.incremento_anual_pct}, ${d.estatus},
                greatest(${desde}::date, ${d.fecha_inicio}::date))
        on conflict (ref_carga) do nothing returning id`
    }),
    saldos: await cargar('saldos', sa, async ({ linea, d }) => {
      const [c] = await sql`select id, dia_pago from contratos where ref_carga = ${d.contrato_ref}`
      if (!c) throw new Error(`saldos.csv línea ${linea}: contrato_ref "${d.contrato_ref}" no existe`)
      return sql`insert into cargos (ref_carga, contrato_id, tipo, periodo, monto, fecha_limite, notas)
        values (${d.ref}, ${c.id}, 'renta', ${d.periodo + '-01'}::date, ${d.monto},
                ${d.periodo + '-01'}::date + (${c.dia_pago}::int - 1), ${d.descripcion})
        on conflict (ref_carga) do nothing returning id`
    }),
  }))
}

if (process.argv[1] && /carga-inicial\.ts$/.test(process.argv[1])) {
  const [dir, fecha] = process.argv.slice(2)
  if (!dir || !fecha) {
    console.error('Uso: npx tsx scripts/carga-inicial.ts <dir> <YYYY-MM-DD>')
    process.exit(1)
  }
  cargarInicial(dir, fecha)
    .then((c) => console.log('Carga inicial completa (filas insertadas):', JSON.stringify(c)))
    .catch((e) => { console.error(`Error: ${(e as Error).message}`); process.exitCode = 1 })
    .finally(() => closeSql())
}
