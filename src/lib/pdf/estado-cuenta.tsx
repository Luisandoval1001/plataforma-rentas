import { Document, Page, renderToBuffer, StyleSheet, Text, View } from '@react-pdf/renderer'

export type Idioma = 'es' | 'en'
export type TipoLinea = 'cobro' | 'gasto_disa' | 'gasto_propietario' | 'ajuste'

export type EstadoCuentaData = {
  propietario: { nombre: string; rfc: string | null }
  /** 'YYYY-MM' */
  periodo: string
  modelo: 'cobra_disa' | 'cobra_propietario'
  comisionPct: number
  lineas: { tipo: TipoLinea | string; descripcion: string; monto: number }[]
  totales: {
    cobrado: number
    /** Parte de lo cobrado que entró a la cuenta de DISA: base del neto. */
    cobradoDisa: number
    comision: number
    iva: number
    gastosDisa: number
    gastosPropietario: number
    ajustes: number
    neto: number
  }
}

const TEXTOS = {
  es: {
    titulo: 'Casas y Terrenos DISA — Estado de cuenta',
    propietario: 'Propietario',
    rfc: 'RFC',
    periodo: 'Periodo',
    modelo: 'Modelo',
    modelos: { cobra_disa: 'Cobra DISA', cobra_propietario: 'Cobra el propietario' },
    comision: 'Comisión',
    tipo: 'Tipo',
    descripcion: 'Descripción',
    monto: 'Monto',
    tipos: { cobro: 'Cobro', gasto_disa: 'Gasto DISA', gasto_propietario: 'Gasto propietario', ajuste: 'Ajuste' },
    sinMovimientos: 'Sin movimientos en el periodo',
    totales: 'Totales',
    cobrado: 'Cobrado',
    cobradoDisa: 'Cobrado en cuenta DISA',
    iva: 'IVA 16%',
    gastosDisa: 'Gastos DISA',
    gastosPropietario: 'Gastos del propietario',
    ajustes: 'Ajustes',
    neto: 'Neto',
    aFavorPropietario: 'Neto a favor del propietario',
    aFavorDisa: 'Saldo a favor de DISA',
    generado: 'Generado el',
  },
  en: {
    titulo: 'Casas y Terrenos DISA — Account statement',
    propietario: 'Owner',
    rfc: 'Tax ID (RFC)',
    periodo: 'Period',
    modelo: 'Model',
    modelos: { cobra_disa: 'DISA collects', cobra_propietario: 'Owner collects' },
    comision: 'Commission',
    tipo: 'Type',
    descripcion: 'Description',
    monto: 'Amount',
    tipos: { cobro: 'Collection', gasto_disa: 'DISA expense', gasto_propietario: 'Owner expense', ajuste: 'Adjustment' },
    sinMovimientos: 'No activity in this period',
    totales: 'Totals',
    cobrado: 'Collected',
    cobradoDisa: 'Collected into DISA account',
    iva: 'VAT 16%',
    gastosDisa: 'DISA expenses',
    gastosPropietario: 'Owner expenses',
    ajustes: 'Adjustments',
    neto: 'Net',
    aFavorPropietario: 'Net in favor of the owner',
    aFavorDisa: 'Balance in favor of DISA',
    generado: 'Generated on',
  },
} as const

const PESOS = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** $#,##0.00 (negativos con signo: -$1,392.00). */
function dinero(n: number): string {
  return `${n < 0 ? '-' : ''}$${PESOS.format(Math.abs(n))}`
}

function hoy(): string {
  const d = new Date()
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

// Helvetica es una fuente estándar de PDF: no se descarga nada.
const s = StyleSheet.create({
  pagina: { padding: 36, fontFamily: 'Helvetica', fontSize: 10, color: '#111' },
  titulo: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginBottom: 12 },
  datos: { marginBottom: 14 },
  dato: { flexDirection: 'row', marginBottom: 2 },
  etiqueta: { width: 90, color: '#555' },
  fila: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#ccc', paddingVertical: 3 },
  encabezado: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#333', paddingVertical: 3, fontFamily: 'Helvetica-Bold' },
  colTipo: { width: 95 },
  colDesc: { flex: 1, paddingRight: 6 },
  colMonto: { width: 85, textAlign: 'right' },
  vacio: { paddingVertical: 6, color: '#555' },
  totales: { marginTop: 16, marginLeft: 'auto', width: 260 },
  subtitulo: { fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  total: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  neto: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#333', marginTop: 4, paddingTop: 4, fontFamily: 'Helvetica-Bold' },
  leyenda: { marginTop: 6, fontFamily: 'Helvetica-Bold' },
  pie: { position: 'absolute', bottom: 24, left: 36, right: 36, fontSize: 8, color: '#777' },
})

function EstadoCuenta({ d, idioma }: { d: EstadoCuentaData; idioma: Idioma }) {
  const t = TEXTOS[idioma]
  const tot = d.totales
  const totales: [string, number][] = [
    [t.cobrado, tot.cobrado],
    [t.cobradoDisa, tot.cobradoDisa],
    [`${t.comision} (${d.comisionPct}%)`, tot.comision],
    [t.iva, tot.iva],
    [t.gastosDisa, tot.gastosDisa],
    [t.gastosPropietario, tot.gastosPropietario],
    [t.ajustes, tot.ajustes],
  ]
  const datos: [string, string][] = [
    [t.propietario, d.propietario.nombre],
    [t.rfc, d.propietario.rfc || '—'],
    [t.periodo, d.periodo],
    [t.modelo, t.modelos[d.modelo]],
    [t.comision, `${d.comisionPct}%`],
  ]
  return (
    <Document title={`${t.titulo} ${d.periodo}`} author="Casas y Terrenos DISA">
      <Page size="LETTER" style={s.pagina}>
        <Text style={s.titulo}>{t.titulo}</Text>
        <View style={s.datos}>
          {datos.map(([k, v]) => (
            <View key={k} style={s.dato}>
              <Text style={s.etiqueta}>{k}</Text>
              <Text>{v}</Text>
            </View>
          ))}
        </View>
        <View style={s.encabezado}>
          <Text style={s.colTipo}>{t.tipo}</Text>
          <Text style={s.colDesc}>{t.descripcion}</Text>
          <Text style={s.colMonto}>{t.monto}</Text>
        </View>
        {d.lineas.length === 0 && <Text style={s.vacio}>{t.sinMovimientos}</Text>}
        {d.lineas.map((l, i) => (
          <View key={i} style={s.fila} wrap={false}>
            <Text style={s.colTipo}>{t.tipos[l.tipo as TipoLinea] ?? l.tipo}</Text>
            <Text style={s.colDesc}>{l.descripcion}</Text>
            <Text style={s.colMonto}>{dinero(l.monto)}</Text>
          </View>
        ))}
        <View style={s.totales} wrap={false}>
          <Text style={s.subtitulo}>{t.totales}</Text>
          {totales.map(([k, v]) => (
            <View key={k} style={s.total}>
              <Text>{k}</Text>
              <Text>{dinero(v)}</Text>
            </View>
          ))}
          <View style={s.neto}>
            <Text>{t.neto}</Text>
            <Text>{dinero(tot.neto)}</Text>
          </View>
          <Text style={s.leyenda}>
            {tot.neto >= 0 ? t.aFavorPropietario : t.aFavorDisa}: {dinero(Math.abs(tot.neto))}
          </Text>
        </View>
        <Text style={s.pie} fixed>
          {t.generado} {hoy()}
        </Text>
      </Page>
    </Document>
  )
}

/** PDF del estado de cuenta de una liquidación. */
export async function renderEstadoCuentaPdf(data: EstadoCuentaData, idioma: Idioma): Promise<Buffer> {
  return renderToBuffer(<EstadoCuenta d={data} idioma={idioma} />)
}
