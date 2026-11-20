import Link from 'next/link'
import { connection } from 'next/server'
import { Suspense } from 'react'
import { Alerta } from '@/components/ui/Alerta'
import { proveedorAuth } from '@/lib/auth/proveedor'
import { idiomaValido, t } from '@/lib/i18n'
import { FormularioEnlace } from './formulario-enlace'

type Params = Promise<{ lang?: string; error?: string; aviso?: string }>

// Sin sesión no hay idioma del propietario: español salvo ?lang=en.
async function Contenido({ searchParams }: { searchParams: Params }) {
  await connection()
  const params = await searchParams
  const idioma = idiomaValido(params.lang)
  const otro = idioma === 'es' ? '?lang=en' : '?lang=es'
  return (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t(idioma, 'login.titulo')}</h1>
        <Link href={`/login${otro}`} className="text-sm text-blue-700 underline">
          {t(idioma, 'login.otroIdioma')}
        </Link>
      </div>
      {params.error === 'enlace' && <Alerta tipo="error">{t(idioma, 'login.enlaceInvalido')}</Alerta>}
      {params.aviso === 'entra' && <Alerta tipo="info">{t(idioma, 'login.avisoEntra')}</Alerta>}
      {proveedorAuth() === 'supabase' ? (
        <FormularioEnlace idioma={idioma} />
      ) : (
        <p>
          {t(idioma, 'login.modoDesarrollo')}{' '}
          <Link href="/dev-login" className="text-blue-700 underline">
            {t(idioma, 'login.usuarioPrueba')}
          </Link>
          .
        </p>
      )}
    </>
  )
}

export default function LoginPage({ searchParams }: { searchParams: Params }) {
  return (
    <main className="mx-auto mt-16 w-full max-w-sm space-y-6 p-6 sm:mt-24">
      <p className="text-sm font-semibold text-blue-800">{t('es', 'marca')}</p>
      <Suspense>
        <Contenido searchParams={searchParams} />
      </Suspense>
    </main>
  )
}
