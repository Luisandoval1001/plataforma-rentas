import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeDb, resetDb, seedUsuarios, sqlAdmin } from '../db/harness'

// El correo es real (archivo local) salvo cuando una prueba pide que falle.
const correo = vi.hoisted(() => ({ fallas: 0 }))
vi.mock('@/lib/email', async (original) => {
  const real = await original<typeof import('@/lib/email')>()
  return {
    ...real,
    sendEmail: (...args: Parameters<typeof real.sendEmail>) => {
      if (correo.fallas > 0) {
        correo.fallas--
        return Promise.reject(new Error('correo caído'))
      }
      return real.sendEmail(...args)
    },
  }
})

const { closeSql } = await import('@/lib/db')
const { ejecutarDiario } = await import('@/lib/jobs/diario')

let ids: Awaited<ReturnType<typeof seedUsuarios>>
let correos: string
let unidadId: string
let inquilinoId: string

async function archivosCorreo() {
  try {
    return await readdir(correos)
  } catch {
    return []
  }
}

async function contrato(diasFin: number) {
  const [c] = await sqlAdmin`insert into contratos (unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago)
    values (${unidadId}, ${inquilinoId}, current_date - 200, current_date + ${diasFin}::int, 10000, 5) returning id`
  return c.id as string
}

beforeAll(async () => {
  correos = await mkdtemp(join(tmpdir(), 'rentas-correos-'))
  process.env.EMAIL_LOCAL_DIR = correos
  await resetDb()
})
beforeEach(async () => {
  correo.fallas = 0
  await sqlAdmin`truncate avisos_enviados, pago_aplicaciones, pagos, cargos, contratos, unidades, inquilinos, inmuebles,
                 propietario_usuarios, propietarios, usuarios cascade`
  await rm(correos, { recursive: true, force: true })
  await sqlAdmin`insert into usuarios (id, email, nombre, rol)
    values ('00000000-0000-0000-0000-000000000001', 'sistema@local', 'Sistema', 'admin')`
  ids = await seedUsuarios()
  await sqlAdmin`update propietarios set contacto_email = 'dueno@a.mx', avisos_contrato = true where id = ${ids.propietarioA}`
  const [inm] = await sqlAdmin`insert into inmuebles (propietario_id, nombre, tipo, cobrador_id)
    values (${ids.propietarioA}, 'Campana 21', 'edificio', ${ids.equipo}) returning id`
  const [uni] = await sqlAdmin`insert into unidades (inmueble_id, nombre) values (${inm.id}, 'Depto 3B') returning id`
  unidadId = uni.id
  const [inq] = await sqlAdmin`insert into inquilinos (nombre) values ('María <López>') returning id`
  inquilinoId = inq.id
})
afterAll(async () => {
  await closeSql()
  await closeDb()
  await rm(correos, { recursive: true, force: true })
})

describe('ejecutarDiario: cargos', () => {
  it('genera los cargos del mes una sola vez', async () => {
    await contrato(300)
    expect((await ejecutarDiario(new Date())).cargosGenerados).toBe(1)
    expect((await ejecutarDiario(new Date())).cargosGenerados).toBe(0)
  })
})

describe('ejecutarDiario: avisos de contrato', () => {
  it('avisa un contrato por vencer una sola vez, con el correo escapado', async () => {
    await contrato(30)
    expect((await ejecutarDiario(new Date())).avisosContrato).toBe(1)
    const [archivo] = await archivosCorreo()
    const msg = JSON.parse(await readFile(join(correos, archivo), 'utf8'))
    expect(msg.to).toBe('dueno@a.mx')
    expect(msg.subject).toContain('Depto 3B')
    expect(msg.html).toContain('María &#60;López&#62;')
    expect((await ejecutarDiario(new Date())).avisosContrato).toBe(0)
    expect(await archivosCorreo()).toHaveLength(1)
  })

  it('no avisa un contrato ya renovado (renovación vigente activada antes de su fin)', async () => {
    const id = await contrato(30)
    await sqlAdmin`insert into contratos (unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago,
        estatus, contrato_origen_id)
      values (${unidadId}, ${inquilinoId}, current_date + 31, current_date + 395, 10500, 5, 'pendiente_firma', ${id})`
    await sqlAdmin`update contratos set estatus = 'terminado' where id = ${id}`
    await sqlAdmin`update contratos set estatus = 'vigente' where contrato_origen_id = ${id}`
    expect((await ejecutarDiario(new Date())).avisosContrato).toBe(0)
  })

  it('no avisa contratos lejos de vencer', async () => {
    await contrato(200)
    expect((await ejecutarDiario(new Date())).avisosContrato).toBe(0)
  })

  it('respeta avisos_contrato = false', async () => {
    await sqlAdmin`update propietarios set avisos_contrato = false where id = ${ids.propietarioA}`
    await contrato(30)
    expect((await ejecutarDiario(new Date())).avisosContrato).toBe(0)
    expect(await archivosCorreo()).toHaveLength(0)
  })

  it('no avisa sin contacto_email', async () => {
    await sqlAdmin`update propietarios set contacto_email = null where id = ${ids.propietarioA}`
    await contrato(30)
    expect((await ejecutarDiario(new Date())).avisosContrato).toBe(0)
  })

  it('si el correo falla no registra el aviso y la siguiente corrida lo envía', async () => {
    const id = await contrato(30)
    correo.fallas = 1
    expect((await ejecutarDiario(new Date())).avisosContrato).toBe(0)
    expect(await sqlAdmin`select 1 from avisos_enviados where referencia_id = ${id}`).toHaveLength(0)
    expect((await ejecutarDiario(new Date())).avisosContrato).toBe(1)
    expect(await sqlAdmin`select 1 from avisos_enviados where referencia_id = ${id}`).toHaveLength(1)
  })

  it('un fallo de correo no detiene los demás contratos', async () => {
    const [u2] = await sqlAdmin`insert into unidades (inmueble_id, nombre)
      select inmueble_id, 'Depto 4C' from unidades where id = ${unidadId} returning id`
    await contrato(30)
    await sqlAdmin`insert into contratos (unidad_id, inquilino_id, fecha_inicio, fecha_fin, renta_mensual, dia_pago)
      values (${u2.id}, ${inquilinoId}, current_date - 200, current_date + 20, 9000, 5)`
    correo.fallas = 1
    expect((await ejecutarDiario(new Date())).avisosContrato).toBe(1)
  })
})
