'use client'

import { useActionState } from 'react'
import { Alerta } from '@/components/ui/Alerta'
import { Boton } from '@/components/ui/Boton'
import { enviarEnlaceAcceso, entrarConContrasena, type EstadoLogin } from '@/lib/auth/acciones'
import { t, type Idioma } from '@/lib/i18n'

const entrada = 'mt-1 block min-h-11 w-full rounded-md border border-gray-300 px-3 py-2 text-base'
const inicial: EstadoLogin = { estado: 'inicial' }

/** Acceso con proveedor supabase: enlace por correo (principal) y contraseña (opcional). */
export function FormularioEnlace({ idioma }: { idioma: Idioma }) {
  const [enlace, pedirEnlace, enviando] = useActionState(enviarEnlaceAcceso, inicial)
  const [clave, entrar, entrando] = useActionState(entrarConContrasena, inicial)

  return (
    <div className="space-y-8">
      <form action={pedirEnlace} className="space-y-4">
        <label className="block">
          <span className="text-sm font-medium">{t(idioma, 'login.email')}</span>
          <input name="email" type="email" autoComplete="email" required className={entrada} />
        </label>
        <Boton type="submit" disabled={enviando} className="w-full">
          {enviando ? t(idioma, 'login.enviando') : t(idioma, 'login.enviarEnlace')}
        </Boton>
        {enlace.estado !== 'inicial' && <Alerta tipo="info">{t(idioma, 'login.enlaceEnviado')}</Alerta>}
      </form>

      <details className="space-y-4">
        <summary className="cursor-pointer text-sm text-gray-700">{t(idioma, 'login.oContrasena')}</summary>
        <form action={entrar} className="mt-4 space-y-4">
          <label className="block">
            <span className="text-sm font-medium">{t(idioma, 'login.email')}</span>
            <input name="email" type="email" autoComplete="email" required className={entrada} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">{t(idioma, 'login.contrasena')}</span>
            <input name="contrasena" type="password" autoComplete="current-password" required className={entrada} />
          </label>
          <Boton type="submit" variante="secundario" disabled={entrando} className="w-full">
            {t(idioma, 'login.entrar')}
          </Boton>
          {clave.estado === 'error' && <Alerta tipo="error">{t(idioma, 'login.credencialesInvalidas')}</Alerta>}
        </form>
      </details>
    </div>
  )
}
