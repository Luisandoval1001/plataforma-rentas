/** Modo demo: instalación con datos ficticios donde se entra eligiendo un usuario (sin correo). */
export function esDemo(): boolean {
  return process.env.MODO_DEMO === '1'
}
