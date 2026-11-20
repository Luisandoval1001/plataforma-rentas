// Rutas que se sirven igual en cualquier subdominio.
const SIN_REWRITE = ['/api', '/auth', '/login', '/dev-login', '/_next']

function empiezaCon(pathname: string, prefijo: string): boolean {
  return pathname === prefijo || pathname.startsWith(`${prefijo}/`)
}

/** Destino del rewrite por subdominio (clientes.* → /clientes, app.* → /app); null si no aplica. */
export function resolverRewrite(host: string, pathname: string): string | null {
  const nombre = host.toLowerCase().split(':')[0]
  const prefijo = nombre.startsWith('clientes.') ? '/clientes' : nombre.startsWith('app.') ? '/app' : null
  if (!prefijo) return null
  if (SIN_REWRITE.some((p) => empiezaCon(pathname, p)) || empiezaCon(pathname, prefijo)) return null
  return pathname === '/' ? prefijo : `${prefijo}${pathname}`
}
