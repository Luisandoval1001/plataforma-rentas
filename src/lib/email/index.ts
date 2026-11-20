import * as local from './local'
import * as resend from './resend'
import type { Email } from './tipos'

export type { Email } from './tipos'

export function sendEmail(msg: Email): Promise<void> {
  return (process.env.EMAIL_PROVIDER === 'resend' ? resend : local).sendEmail(msg)
}
