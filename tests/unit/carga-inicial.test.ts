import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeDb, resetDb, sqlAdmin } from '../db/harness'

const { closeSql } = await import('@/lib/db')
const { cargarInicial } = await import('../../scripts/carga-inicial')

const EJEMPLO = join(process.cwd(), 'carga', 'ejemplo')
const ARRANQUE = '2026-10-01'

async function copiaEjemplo() {
  const dir = await mkdtemp(join(tmpdir(), 'rentas-carga-'))
  await cp(EJEMPLO, dir, { recursive: true })
  return dir
}

async function conteos() {
  const [r] = await sqlAdmin`select
    (select count(*) from propietarios where ref_carga is not null)::int as propietarios,
    (select count(*) from inmuebles where ref_carga is not null)::int as inmuebles,
    (select count(*) from unidades where ref_carga is not null)::int as unidades,
    (select count(*) from inquilinos where ref_carga is not null)::int as inquilinos,
    (select count(*) from contratos where ref_carga is not null)::int as contratos,
    (select count(*) from cargos where ref_carga is not null)::int as saldos`
  return { ...r }
}

beforeAll(async () => {
  await resetDb()
})
afterAll(async () => {
  await closeSql()
  await closeDb()
})

describe('carga inicial', () => {
  it('rechaza un CSV inválido nombrando archivo y línea, sin insertar nada', async () => {
    const dir = await copiaEjemplo()
    const csv = await readFile(join(dir, 'contratos.csv'), 'utf8')
    await writeFile(join(dir, 'contratos.csv'), csv.replace(',2026-12-31,12000,5,', ',2026-12-31,12000,31,'))
    await expect(cargarInicial(dir, ARRANQUE)).rejects.toThrow(/contratos\.csv.*línea 2/)
    expect(await conteos()).toEqual({ propietarios: 0, inmuebles: 0, unidades: 0, inquilinos: 0, contratos: 0, saldos: 0 })
  })

  it('revierte todo si una referencia no existe (falla dentro de la transacción)', async () => {
    const dir = await copiaEjemplo()
    const csv = await readFile(join(dir, 'contratos.csv'), 'utf8')
    await writeFile(join(dir, 'contratos.csv'), csv.replace('CON-003,UNI-003', 'CON-003,UNI-999'))
    await expect(cargarInicial(dir, ARRANQUE)).rejects.toThrow(/contratos\.csv.*línea 4.*UNI-999/)
    expect(await conteos()).toEqual({ propietarios: 0, inmuebles: 0, unidades: 0, inquilinos: 0, contratos: 0, saldos: 0 })
  })

  it('primer_periodo_cargo inválido o anterior al inicio del contrato se rechaza', async () => {
    const dir = await copiaEjemplo()
    const csv = await readFile(join(dir, 'contratos.csv'), 'utf8')
    await writeFile(join(dir, 'contratos.csv'), csv.replace(',vigente,2026-11', ',vigente,2025-12'))
    await expect(cargarInicial(dir, ARRANQUE)).rejects.toThrow(/contratos\.csv.*línea 2.*primer_periodo_cargo/)
    await writeFile(join(dir, 'contratos.csv'), csv.replace(',vigente,2026-11', ',vigente,noviembre'))
    await expect(cargarInicial(dir, ARRANQUE)).rejects.toThrow(/contratos\.csv.*línea 2.*primer_periodo_cargo/)
    expect((await conteos()).contratos).toBe(0)
  })

  it('contratos.csv sin la columna primer_periodo_cargo también se acepta', async () => {
    const dir = await copiaEjemplo()
    const csv = await readFile(join(dir, 'contratos.csv'), 'utf8')
    const sinColumna = csv.trimEnd().split('\n').map((l) => l.split(',').slice(0, 10).join(',')).join('\n') + '\n'
    await writeFile(join(dir, 'contratos.csv'), sinColumna)
    const r = await cargarInicial(dir, ARRANQUE)
    expect(r.contratos).toBe(3)
    const [c] = await sqlAdmin`select cargos_desde::text as d from contratos where ref_carga = 'CON-001'`
    expect(c.d).toBe('2026-01-01')
    await sqlAdmin`truncate cargos, contratos, unidades, inquilinos, inmuebles, propietario_usuarios, propietarios cascade`
  })

  it('rechaza un saldo con periodo posterior al mes de arranque', async () => {
    const dir = await copiaEjemplo()
    const csv = await readFile(join(dir, 'saldos.csv'), 'utf8')
    await writeFile(join(dir, 'saldos.csv'), csv.replace('2026-09', '2026-11'))
    await expect(cargarInicial(dir, ARRANQUE)).rejects.toThrow(/saldos\.csv.*línea 2/)
    expect((await conteos()).propietarios).toBe(0)
  })

  it('carga el ejemplo con los conteos esperados', async () => {
    const r = await cargarInicial(EJEMPLO, ARRANQUE)
    expect(r).toEqual({ propietarios: 2, inmuebles: 2, unidades: 3, inquilinos: 3, contratos: 3, saldos: 1 })
    const [p] = await sqlAdmin`select nombre from propietarios where ref_carga = 'PROP-002'`
    expect(p.nombre).toBe('Propietario Ejemplo 2, S.A. de C.V.')
  })

  it('el saldo queda como cargo de renta vencido con fecha límite = día de pago', async () => {
    const [c] = await sqlAdmin`select v.tipo, v.periodo::text as periodo, v.fecha_limite::text as fecha_limite, v.monto::text as monto,
      v.notas, v.estatus, v.propietario_id is not null as con_prop
      from v_cargos v join cargos c on c.id = v.id where c.ref_carga = 'SAL-001'`
    expect(c).toMatchObject({
      tipo: 'renta', periodo: '2026-09-01', fecha_limite: '2026-09-05', monto: '12000.00',
      notas: 'Renta de septiembre pendiente al arranque', estatus: 'vencido', con_prop: true,
    })
  })

  it('primer_periodo_cargo fija cargos_desde (por omisión fecha_inicio)', async () => {
    const rs = await sqlAdmin`select ref_carga, cargos_desde::text as d from contratos where ref_carga is not null order by ref_carga`
    expect(rs.map((r) => [r.ref_carga, r.d])).toEqual([
      ['CON-001', '2026-11-01'],
      ['CON-002', '2026-03-01'],
      ['CON-003', '2026-12-01'],
    ])
  })

  it('es idempotente: la segunda corrida no inserta nada', async () => {
    const r = await cargarInicial(EJEMPLO, ARRANQUE)
    expect(r).toEqual({ propietarios: 0, inmuebles: 0, unidades: 0, inquilinos: 0, contratos: 0, saldos: 0 })
    expect(await conteos()).toEqual({ propietarios: 2, inmuebles: 2, unidades: 3, inquilinos: 3, contratos: 3, saldos: 1 })
  })
})
