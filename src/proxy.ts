import { NextResponse, type NextRequest } from 'next/server'
import { resolverRewrite } from '@/lib/routing'

export function proxy(request: NextRequest) {
  const destino = resolverRewrite(request.headers.get('host') ?? '', request.nextUrl.pathname)
  if (!destino) return NextResponse.next()
  const url = request.nextUrl.clone()
  url.pathname = destino
  return NextResponse.rewrite(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
