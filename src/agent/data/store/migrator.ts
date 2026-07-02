import type { Database } from 'sql.js'
import { readdirSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

let migrationsPath = ''

export function setMigrationsPath(path: string): void {
  migrationsPath = path
}

export function runMigrations(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    executed_at TEXT NOT NULL
  )`)

  const executed = new Set<string>()
  const stmt = db.prepare('SELECT version FROM schema_migrations')
  while (stmt.step()) {
    const row = stmt.getAsObject()
    executed.add(row.version as string)
  }
  stmt.free()

  if (!migrationsPath || !existsSync(migrationsPath)) {
    console.error('[Migration] Migrations directory not set or not found:', migrationsPath)
    return
  }

  const files = readdirSync(migrationsPath)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const version = file.replace('.sql', '')
    if (executed.has(version)) continue

    const sql = readFileSync(join(migrationsPath, file), 'utf-8')
    const lines = sql.split('\n').filter(l => !l.trimStart().startsWith('--')).join('\n')
    const statements = lines
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    for (const statement of statements) {
      try {
        db.run(statement)
      } catch (e) {
        console.error(`[Migration] ${version}: ${statement.slice(0, 60)}...`, e)
      }
    }

    db.run('INSERT INTO schema_migrations (version, executed_at) VALUES (?, ?)', [version, new Date().toISOString()])
    console.log(`[Migration] Applied: ${version}`)
  }
}
