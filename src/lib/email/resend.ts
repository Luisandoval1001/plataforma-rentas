import { Resend } from 'resend'
import type { Email } from './tipos'

export async function sendEmail(msg: Email): Promise<void> {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('Falta RESEND_API_KEY')
  const from = process.env.EMAIL_FROM ?? 'DISA <no-reply@ctdisa.com>'
  const { error } = await new Resend(key).emails.send({ from, ...msg })
  if (error) throw new Error(`Resend: ${error.message}`)
}
