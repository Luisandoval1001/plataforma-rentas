import Link from 'next/link'

export default function Prohibido() {
  return (
    <main className="mx-auto mt-24 w-full max-w-md space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Sin permiso</h1>
      <p className="text-gray-700">Tu usuario no tiene permiso para ver esta página.</p>
      <Link href="/" className="text-blue-700 underline">
        Ir al inicio
      </Link>
    </main>
  )
}
