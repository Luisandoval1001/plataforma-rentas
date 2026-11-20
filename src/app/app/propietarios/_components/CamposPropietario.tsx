import { Campo, CampoCasilla, CampoSelect } from '@/components/ui/Campo'
import type { Propietario } from '@/lib/queries/propietarios'

/** Campos del alta y la edición de propietario (sólo admin). */
export function CamposPropietario({ p }: { p?: Propietario }) {
  return (
    <>
      <Campo etiqueta="Nombre o razón social" name="nombre" defaultValue={p?.nombre} required />
      <Campo etiqueta="RFC" name="rfc" defaultValue={p?.rfc ?? ''} autoCapitalize="characters" />
      <CampoSelect
        etiqueta="Modelo de dinero"
        name="modelo"
        defaultValue={p?.modelo ?? ''}
        vacio="Selecciona…"
        opciones={[
          { valor: 'cobra_disa', texto: 'Cobra DISA' },
          { valor: 'cobra_propietario', texto: 'Cobra propietario' },
        ]}
        required
      />
      <Campo
        etiqueta="Comisión (%)"
        name="comision_pct"
        inputMode="decimal"
        defaultValue={p ? String(Number(p.comision_pct)) : ''}
        ayuda="Normalmente 15 o 12"
        required
      />
      <Campo
        etiqueta="Cuenta para liquidación (últimos 4 dígitos)"
        name="cuenta_ultimos4"
        inputMode="numeric"
        maxLength={4}
        defaultValue={p?.cuenta_ultimos4 ?? ''}
      />
      <Campo etiqueta="Correo de contacto" name="contacto_email" type="email" defaultValue={p?.contacto_email ?? ''} />
      <Campo etiqueta="Teléfono de contacto" name="contacto_tel" type="tel" defaultValue={p?.contacto_tel ?? ''} />
      <CampoSelect
        etiqueta="Idioma"
        name="idioma"
        defaultValue={p?.idioma ?? 'es'}
        opciones={[
          { valor: 'es', texto: 'Español' },
          { valor: 'en', texto: 'Inglés' },
        ]}
      />
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium text-gray-800">Opciones</legend>
        <CampoCasilla etiqueta="Recargo por mora visible al propietario" name="recargo_visible" defaultChecked={p?.recargo_visible ?? false} />
        <CampoCasilla etiqueta="Los recargos son del propietario" name="recargos_al_propietario" defaultChecked={p?.recargos_al_propietario ?? false} />
        <CampoCasilla etiqueta="Aviso por correo de cada pago" name="avisos_pago" defaultChecked={p?.avisos_pago ?? true} />
        <CampoCasilla etiqueta="Aviso de estado de cuenta" name="avisos_estado_cuenta" defaultChecked={p?.avisos_estado_cuenta ?? true} />
        <CampoCasilla etiqueta="Avisos de contratos" name="avisos_contrato" defaultChecked={p?.avisos_contrato ?? true} />
      </fieldset>
    </>
  )
}
