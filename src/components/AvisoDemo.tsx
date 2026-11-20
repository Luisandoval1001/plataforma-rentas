import Link from 'next/link'

/** Franja fija del modo demo: recuerda que los datos son ficticios y deja cambiar de usuario. */
export function AvisoDemo() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-100 px-3 py-1.5 text-center text-sm text-amber-900">
      <span>
        <strong>Demo</strong> · datos ficticios
      </span>
      <Link href="/dev-login" className="font-medium underline">
        Cambiar de usuario
      </Link>
    </div>
  )
}
