import initSqlJs, { type Database } from 'sql.js'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

let db: Database | null = null
let dbPath = ''
let saveTimer: ReturnType<typeof setTimeout> | null = null

export async function getDb(basePath: string): Promise<Database> {
  if (db) return db

  const dataDir = join(basePath, 'data')
  mkdirSync(dataDir, { recursive: true })
  dbPath = join(dataDir, 'market.db')

  const SQL = await initSqlJs()

  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  return db
}

export function getDbSync(): Database | null {
  return db
}

export function saveDb(): void {
  if (!db || !dbPath) return
  const data = db.export()
  writeFileSync(dbPath, Buffer.from(data))
}

export function scheduleSave(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveDb()
    saveTimer = null
  }, 5000)
}

export function closeDb(): void {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null }
  if (db) {
    saveDb()
    db.close()
    db = null
  }
}
