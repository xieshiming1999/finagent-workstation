import { cpSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

export function projectDirForCwd(cwd: string): string {
  const parts = cwd
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(sanitizeProjectPathSegment)
    .filter(Boolean)
  return join('by-cwd', ...(parts.length > 0 ? parts : ['root']))
}

function sanitizeProjectPathSegment(segment: string): string {
  const sanitized = segment
    .normalize('NFC')
    .replace(/[\/\\:\0-\x1F\x7F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return sanitized || '_'
}

export function resolveProjectBasePath(globalBase: string, cwd: string): string {
  return join(globalBase, 'projects', projectDirForCwd(cwd))
}

export function dashSanitizeCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9_.-]/g, '-')
}

export function legacyDashSanitizeCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

export function findLegacyProjectBasePath(globalBase: string, cwd: string): string | null {
  const target = resolveProjectBasePath(globalBase, cwd)
  const projectsDir = join(globalBase, 'projects')
  const candidates = Array.from(new Set([
    join(projectsDir, dashSanitizeCwd(cwd)),
    join(projectsDir, legacyDashSanitizeCwd(cwd)),
  ])).filter((candidate) => candidate !== target)
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export function migrateLegacyProjectBasePath(globalBase: string, cwd: string): { migrated: boolean; from?: string; to: string } {
  const target = resolveProjectBasePath(globalBase, cwd)
  if (existsSync(target)) return { migrated: false, to: target }
  const legacy = findLegacyProjectBasePath(globalBase, cwd)
  if (!legacy) return { migrated: false, to: target }
  mkdirSync(join(globalBase, 'projects'), { recursive: true })
  cpSync(legacy, target, { recursive: true, dereference: false, errorOnExist: true })
  return { migrated: true, from: legacy, to: target }
}
