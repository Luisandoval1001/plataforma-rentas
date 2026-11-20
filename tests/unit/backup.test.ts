import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import postgres from 'postgres'
import { asUser, closeDb, IDS, resetDb, seedUsuarios, sqlAdmin } from '../db/harness'

let dir: string

beforeAll(async () => {
  await resetDb()
  dir = await mkdtemp(join(tmpdir(), 'rentas-backup-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  await closeDb()
})

describe('backup.sh', () => {
  it('genera el volcado .sql.gz y el tar de archivos locales', async () => {
    const salida = execFileSync('bash', ['scripts/backup.sh'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...process.env,
        STORAGE_PROVIDER: 'local',
        BACKUP_DIR: dir,
        STORAGE_LOCAL_ROOT: process.cwd() + '/storage',
        RCLONE_REMOTE: '',
      },
    })
    const archivos = await readdir(dir)
    const sql = archivos.find((f) => /^\d{4}-\d{2}-\d{2}-\d{4}\.sql\.gz$/.test(f))
    expect(sql).toBeDefined()
    const volcado = gunzipSync(readFileSync(join(dir, sql!))).toString('utf8')
    expect(volcado).toContain('CREATE TABLE')
    // Sólo los esquemas de la aplicación (restaurable en Supabase, que ya trae auth, storage, …).
    expect(volcado).toContain('CREATE TABLE public.pagos')
    expect(volcado).toContain('CREATE SCHEMA app;')
    expect(volcado).toContain('CREATE FUNCTION app.rol_actual()')
    expect(volcado).not.toMatch(/CREATE SCHEMA (auth|public)|CREATE FUNCTION auth\./)
    expect(volcado).not.toMatch(/^(GRANT|REVOKE|ALTER [A-Z ]+ OWNER TO)/m)
    expect(archivos.some((f) => /^archivos-.*\.tar\.gz$/.test(f))).toBe(true)
    expect(salida).toContain('Respaldo')
  })

  it('con STORAGE_PROVIDER=supabase y sin CLI falla y no deja .sql.gz', async () => {
    const sub = await mkdtemp(join(tmpdir(), 'rentas-backup-sb-'))
    const PATH = (process.env.PATH ?? '').split(':').filter((d) => !existsSync(join(d, 'supabase'))).join(':')
    const r = spawnSync('bash', ['scripts/backup.sh'], {
      cwd: process.cwd(), encoding: 'utf8',
      env: { ...process.env, PATH, STORAGE_PROVIDER: 'supabase', BACKUP_DIR: sub, RCLONE_REMOTE: '' },
    })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('supabase')
    expect((await readdir(sub)).filter((f) => f.includes('.sql.gz'))).toEqual([])
    await rm(sub, { recursive: true, force: true })
  })

  it('con DATABASE_ADMIN_URL inválida falla y no deja .sql.gz truncado', async () => {
    const sub = await mkdtemp(join(tmpdir(), 'rentas-backup-bad-'))
    const r = spawnSync('bash', ['scripts/backup.sh'], {
      cwd: process.cwd(), encoding: 'utf8',
      env: { ...process.env, DATABASE_ADMIN_URL: 'postgres://x:y@127.0.0.1:1/nada', STORAGE_PROVIDER: 'local', BACKUP_DIR: sub, RCLONE_REMOTE: '' },
    })
    expect(r.status).not.toBe(0)
    expect((await readdir(sub)).filter((f) => f.includes('.sql.gz'))).toEqual([])
    await rm(sub, { recursive: true, force: true })
  })

  it('el volcado se restaura en una base nueva: permisos y reasignación de usuarios (guía §11.5)', async () => {
    // Datos con referencias a usuarios: liga del portal y una liquidación cerrada por el admin.
    const u = await seedUsuarios()
    const [l] = await asUser(IDS.admin, (s) => s`select preparar_liquidacion(${u.propietarioA}, '2026-03-01') as id`)
    await asUser(IDS.admin, (s) => s`select cerrar_liquidacion(${l.id})`)

    const sub = await mkdtemp(join(tmpdir(), 'rentas-restaurar-'))
    execFileSync('bash', ['scripts/backup.sh'], {
      cwd: process.cwd(),
      env: { ...process.env, STORAGE_PROVIDER: 'local', BACKUP_DIR: sub, BACKUP_SKIP_ARCHIVOS: '1', RCLONE_REMOTE: '' },
    })
    const volcado = gunzipSync(readFileSync(join(sub, (await readdir(sub)).find((f) => f.endsWith('.sql.gz'))!)))

    const destino = 'rentas_restaurar'
    await sqlAdmin.unsafe(`drop database if exists ${destino} with (force)`)
    await sqlAdmin.unsafe(`create database ${destino}`)
    const url = new URL(process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/rentas_test')
    url.pathname = `/${destino}`
    const psql = (entrada: string | Buffer) => {
      const r = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', url.toString()], { input: entrada, encoding: 'utf8' })
      if (r.status !== 0) throw new Error(r.stderr)
    }
    // Paso 2 de la guía (aquí: roles y shim de auth locales), volcado, permisos y remapeo.
    psql(readFileSync('supabase/local/00_roles.sql'))
    psql(readFileSync('supabase/local/auth_shim.sql'))
    psql(volcado)
    psql(readFileSync('scripts/reaplicar-permisos.sql'))
    const NUEVO_ADMIN = '11111111-1111-1111-1111-111111111111'
    const NUEVO_PROP = '22222222-2222-2222-2222-222222222222'
    psql(
      readFileSync('scripts/remapear-usuarios.sql', 'utf8').replace(
        "('correo@ejemplo.com', '00000000-0000-0000-0000-000000000000');",
        `('admin@local', '${NUEVO_ADMIN}'), ('PropA@local', '${NUEVO_PROP}');`,
      ),
    )

    const db = postgres(url.toString(), { max: 1, onnotice: () => {} })
    try {
      const [r] = await db`select
        (select count(*)::int from usuarios where id in (${NUEVO_ADMIN}, ${NUEVO_PROP})) as remapeados,
        (select cerrada_por from liquidaciones where id = ${l.id}) as cerrada_por,
        (select count(*)::int from propietario_usuarios where usuario_id = ${NUEVO_PROP}) as ligas,
        (select estatus from liquidaciones where id = ${l.id}) as estatus,
        has_table_privilege('app_server', 'pagos', 'insert') as app_inserta_pagos,
        has_table_privilege('app_server', 'cargos', 'select') as app_lee_cargos`
      expect(r).toEqual({
        remapeados: 2, cerrada_por: NUEVO_ADMIN, ligas: 1, estatus: 'cerrada', app_inserta_pagos: false, app_lee_cargos: true,
      })
      // La aplicación (app_server + RLS) funciona con el id nuevo.
      const filas = await db.begin(async (tx) => {
        await tx`set local role app_server`
        await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: NUEVO_ADMIN })}, true)`
        return tx`select app.rol_actual() as rol, (select count(*)::int from propietarios) as n`
      })
      expect([...filas]).toEqual([{ rol: 'admin', n: 2 }])
    } finally {
      await db.end({ timeout: 5 })
      await sqlAdmin.unsafe(`drop database if exists ${destino} with (force)`)
      await rm(sub, { recursive: true, force: true })
    }
  })
})
