import { redirect } from 'next/navigation'
import { connection } from 'next/server'
import { Suspense } from 'react'
import { esDemo } from '@/lib/demo'

// La raíz sólo se ve fuera de los subdominios (app.* y clientes.* se reescriben en src/proxy.ts).
async function IrAlAcceso(): Promise<never> {
  await connection()
  redirect(esDemo() ? '/dev-login' : '/login')
}

export default function Inicio() {
  return (
    <Suspense>
      <IrAlAcceso />
    </Suspense>
  )
}
