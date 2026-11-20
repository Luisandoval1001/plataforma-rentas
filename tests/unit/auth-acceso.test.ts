import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  signInWithOtp: vi.fn(),
  signInWithPassword: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
}))
const frasco = vi.hoisted(() => ({ borradas: [] as string[], encabezados: {} as Record<string, string> }))
const sesiones = vi.hoisted(() => new Map<string, { rol: string }>())

vi.mock('@/lib/auth/providers/supabase', () => ({ crearClienteSupabase: async () => ({ auth }) }))
vi.mock('@/lib/auth/cargar', () => ({ cargarSesion: async (id: string) => sesiones.get(id) ?? null }))
vi.mock('next/headers', () => ({
  headers: async () => new Headers(frasco.encabezados),
  cookies: async () => ({ delete: (n: string) => frasco.borradas.push(n) }),
}))
// connection() exige el contexto de una petición de Next; aquí no hay prerender que evitar.
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  connection: async () => {},
}))
vi.mock('next/navigation', () => ({
  redirect: (ruta: string) => {
    throw new Error(`REDIRECT:${ruta}`)
  },
  forbidden: () => {
    throw new Error('FORBIDDEN')
  },
}))

const { cerrarSesion, enviarEnlaceAcceso, entrarConContrasena } = await import('@/lib/auth/acciones')
const { GET } = await import('@/app/auth/callback/route')

const fd = (d: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(d)) f.set(k, v)
  return f
}
const inicial = { estado: 'inicial' as const }

beforeEach(() => {
  vi.stubEnv('AUTH_PROVIDER', 'supabase')
  vi.stubEnv('APP_URL', 'https://app.ctdisa.com')
  vi.stubEnv('CLIENTES_URL', 'https://clientes.ctdisa.com')
  frasco.encabezados = { host: 'clientes.ctdisa.com' }
  for (const f of Object.values(auth)) f.mockReset()
  frasco.borradas = []
  sesiones.clear()
  sesiones.set('u-prop', { rol: 'propietario' })
  sesiones.set('u-eq', { rol: 'equipo' })
})
afterEach(() => vi.unstubAllEnvs())

describe('enviarEnlaceAcceso', () => {
  it('pide el OTP con regreso a /auth/callback y sin crear usuarios', async () => {
    auth.signInWithOtp.mockResolvedValue({ error: null })
    expect(await enviarEnlaceAcceso(inicial, fd({ email: ' Dueno@A.mx ' }))).toEqual({ estado: 'enviado' })
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'dueno@a.mx',
      options: { shouldCreateUser: false, emailRedirectTo: 'https://clientes.ctdisa.com/auth/callback' },
    })
  })

  it('el regreso sale de la configuración, nunca de encabezados hostiles', async () => {
    auth.signInWithOtp.mockResolvedValue({ error: null })
    const regreso = () => auth.signInWithOtp.mock.lastCall?.[0].options.emailRedirectTo as string
    frasco.encabezados = { host: 'evil.example', origin: 'https://evil.example', 'x-forwarded-host': 'evil.example' }
    await enviarEnlaceAcceso(inicial, fd({ email: 'a@a.mx' }))
    expect(regreso()).toBe('https://clientes.ctdisa.com/auth/callback')
    frasco.encabezados = { host: 'clientes.ctdisa.com', origin: 'https://evil.example' }
    await enviarEnlaceAcceso(inicial, fd({ email: 'a@a.mx' }))
    expect(regreso().startsWith('https://clientes.ctdisa.com/')).toBe(true)
    frasco.encabezados = { host: 'app.ctdisa.com', origin: 'https://evil.example' }
    await enviarEnlaceAcceso(inicial, fd({ email: 'a@a.mx' }))
    expect(regreso()).toBe('https://app.ctdisa.com/auth/callback')
  })

  it('misma respuesta si el correo no existe (sin enumeración)', async () => {
    auth.signInWithOtp.mockResolvedValue({ error: { message: 'Signups not allowed for otp' } })
    expect(await enviarEnlaceAcceso(inicial, fd({ email: 'nadie@x.mx' }))).toEqual({ estado: 'enviado' })
  })

  it('correo mal formado → error sin llamar a supabase', async () => {
    expect(await enviarEnlaceAcceso(inicial, fd({ email: 'no-es-correo' }))).toEqual({ estado: 'error' })
    expect(auth.signInWithOtp).not.toHaveBeenCalled()
  })
})

describe('entrarConContrasena', () => {
  it('credenciales válidas → redirige por rol', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'u-prop' } }, error: null })
    await expect(entrarConContrasena(inicial, fd({ email: 'a@a.mx', contrasena: 'x' }))).rejects.toThrow(
      'REDIRECT:/clientes',
    )
  })

  it('credenciales inválidas → error genérico', async () => {
    auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'Invalid' } })
    expect(await entrarConContrasena(inicial, fd({ email: 'a@a.mx', contrasena: 'x' }))).toEqual({ estado: 'error' })
  })
})

describe('/auth/callback', () => {
  const pedirEn = async (host: string, qs: string) => {
    const { NextRequest } = await import('next/server')
    return GET(new NextRequest(`https://${host}/auth/callback${qs}`))
  }
  const pedir = (qs: string) => pedirEn('clientes.ctdisa.com', qs)

  it('token_hash (enlace mágico, sirve en otro dispositivo): verifyOtp y redirige por rol', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: { id: 'u-prop' } }, error: null })
    expect((await pedir('?token_hash=th1&type=email')).headers.get('location')).toBe('https://clientes.ctdisa.com/clientes')
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: 'email', token_hash: 'th1' })
    // Equipo en el host del portal (p. ej. invitación con Site URL = clientes): su sesión es de
    // app.ctdisa.com, así que se le manda a entrar ahí.
    auth.verifyOtp.mockResolvedValue({ data: { user: { id: 'u-eq' } }, error: null })
    expect((await pedir('?token_hash=th2&type=invite')).headers.get('location')).toBe('https://app.ctdisa.com/login?aviso=entra')
    expect(auth.verifyOtp).toHaveBeenLastCalledWith({ type: 'invite', token_hash: 'th2' })
    expect((await pedirEn('app.ctdisa.com', '?token_hash=th3&type=email')).headers.get('location')).toBe('https://app.ctdisa.com/app')
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it('token_hash: verificación fallida, tipo no permitido, sin tipo o usuario inactivo → /login?error=enlace', async () => {
    auth.verifyOtp.mockResolvedValue({ data: { user: null }, error: { message: 'Token has expired or is invalid' } })
    expect((await pedir('?token_hash=th&type=email')).headers.get('location')).toMatch(/\/login\?error=enlace$/)
    auth.verifyOtp.mockClear()
    expect((await pedir('?token_hash=th&type=recovery')).headers.get('location')).toMatch(/\/login\?error=enlace$/)
    expect((await pedir('?token_hash=th')).headers.get('location')).toMatch(/\/login\?error=enlace$/)
    expect((await pedir('?type=email')).headers.get('location')).toMatch(/\/login\?error=enlace$/)
    expect(auth.verifyOtp).not.toHaveBeenCalled()
    auth.verifyOtp.mockResolvedValue({ data: { user: { id: 'u-inactivo' } }, error: null })
    expect((await pedir('?token_hash=th&type=email')).headers.get('location')).toMatch(/\/login\?error=enlace$/)
    expect(auth.signOut).toHaveBeenCalled()
  })

  it('canjea el código (respaldo PKCE) y redirige: propietario → /clientes, equipo → /app', async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'u-prop' } }, error: null })
    expect((await pedir('?code=abc')).headers.get('location')).toBe('https://clientes.ctdisa.com/clientes')
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('abc')
    auth.exchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'u-eq' } }, error: null })
    expect((await pedirEn('app.ctdisa.com', '?code=def')).headers.get('location')).toBe('https://app.ctdisa.com/app')
  })

  it('sin código, código inválido o usuario inactivo → /login?error=enlace', async () => {
    expect((await pedir('')).headers.get('location')).toMatch(/\/login\?error=enlace$/)
    auth.exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: { message: 'bad' } })
    expect((await pedir('?code=x')).headers.get('location')).toMatch(/\/login\?error=enlace$/)
    auth.exchangeCodeForSession.mockResolvedValue({ data: { user: { id: 'u-inactivo' } }, error: null })
    expect((await pedir('?code=y')).headers.get('location')).toMatch(/\/login\?error=enlace$/)
    expect(auth.signOut).toHaveBeenCalled()
  })

  it('con proveedor local → 404', async () => {
    vi.stubEnv('AUTH_PROVIDER', 'local')
    expect((await pedir('?code=abc')).status).toBe(404)
  })
})

describe('cerrarSesion', () => {
  it('supabase: signOut y al login', async () => {
    await expect(cerrarSesion()).rejects.toThrow('REDIRECT:/login')
    expect(auth.signOut).toHaveBeenCalled()
  })

  it('local: borra la cookie de sesión y al login', async () => {
    vi.stubEnv('AUTH_PROVIDER', 'local')
    await expect(cerrarSesion()).rejects.toThrow('REDIRECT:/login')
    expect(frasco.borradas).toEqual(['sesion'])
    expect(auth.signOut).not.toHaveBeenCalled()
  })
})
