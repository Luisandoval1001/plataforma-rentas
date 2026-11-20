import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import postgres from 'postgres'

const url = process.env.DATABASE_ADMIN_URL
if (!url) {
  console.error('Falta DATABASE_ADMIN_URL')
  process.exit(1)
}

const dir = join(process.cwd(), 'supabase', 'migrations')
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

async function main() {
  const sql = postgres(url!, { max: 1, onnotice: () => {} })
  try {
    for (const file of files) {
      const content = readFileSync(join(dir, file), 'utf8')
      await sql.begin((tx) => tx.unsafe(content).simple())
      console.log(file)
    }
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
