import type { Database } from 'sql.js'
import { runMigrations } from './migrator'

export function initSchema(db: Database): void {
  runMigrations(db)
}
