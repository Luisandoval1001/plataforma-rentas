import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const job = vi.hoisted(() => ({ ejecutarDiario: vi.fn() }))
vi.mock('@/lib/jobs/diario', () => job)

const { GET, POST } = await import('@/app/api/cron/diario/route')

const req = (auth?: string, method = 'GET') =>
  new Request('http://localhost/api/cron/diario', { method, headers: auth ? { authorization: auth } : {} })

beforeEach(() => {
  process.env.CRON_SECRET = 's3cret'
  job.ejecutarDiario.mockReset().mockResolvedValue({ cargosGenerados: 2, avisosContrato: 3 })
})
afterEach(() => vi.restoreAllMocks())

describe('/api/cron/diario', () => {
  it('sin encabezado → 401', async () => {
    expect((await GET(req())).status).toBe(401)
    expect(job.ejecutarDiario).not.toHaveBeenCalled()
  })
  it('secreto incorrecto → 401', async () => {
    expect((await GET(req('Bearer otro'))).status).toBe(401)
    expect((await GET(req('Bearer s3cret-largo'))).status).toBe(401)
  })
  it('secreto correcto → 200 con los dos números (GET y POST)', async () => {
    for (const [h, m] of [[GET, 'GET'], [POST, 'POST']] as const) {
      const r = await h(req('Bearer s3cret', m))
      expect(r.status).toBe(200)
      expect(await r.json()).toEqual({ cargosGenerados: 2, avisosContrato: 3 })
    }
  })
  it('CRON_SECRET sin configurar → 500', async () => {
    delete process.env.CRON_SECRET
    const r = await GET(req('Bearer '))
    expect(r.status).toBe(500)
    expect(await r.text()).toContain('CRON_SECRET no configurado')
    expect(job.ejecutarDiario).not.toHaveBeenCalled()
  })
  it('si el job lanza → 500 genérico', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    job.ejecutarDiario.mockRejectedValue(new Error('detalle interno'))
    const r = await GET(req('Bearer s3cret'))
    expect(r.status).toBe(500)
    expect(await r.text()).not.toContain('detalle interno')
  })
})
