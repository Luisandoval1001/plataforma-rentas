import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sendEmail } from '@/lib/email'

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'emails-'))
  process.env.EMAIL_LOCAL_DIR = dir
  process.env.EMAIL_PROVIDER = 'local'
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env.EMAIL_LOCAL_DIR
})

describe('email local', () => {
  it('sendEmail escribe un JSON con to, subject y html', async () => {
    await sendEmail({ to: 'a@b.com', subject: 'Hola', html: '<p>x</p>' })
    await sendEmail({ to: 'c@d.com', subject: 'Otro', html: '<p>y</p>' })
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    expect(files).toHaveLength(2)
    const msgs = files.map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
    expect(msgs.map((m) => m.to).sort()).toEqual(['a@b.com', 'c@d.com'])
    const hola = msgs.find((m) => m.to === 'a@b.com')
    expect(hola).toMatchObject({ subject: 'Hola', html: '<p>x</p>' })
  })
})
