import { isAbsolute, join, normalize, resolve } from 'path'
import type { ToolContext } from '../tool'

export function resolveToolPath(rawPath: string, ctx: ToolContext): string {
  if (isAbsolute(rawPath)) return rawPath

  const normalized = normalize(rawPath).replace(/\\/g, '/')
  if (normalized === 'memory') return ctx.memoryDir
  if (normalized.startsWith('memory/')) return join(ctx.memoryDir, normalized.slice('memory/'.length))
  if (normalized === 'bundle') return ctx.bundleDir
  if (normalized.startsWith('bundle/')) return join(ctx.bundleDir, normalized.slice('bundle/'.length))

  return resolve(ctx.workDir, rawPath)
}

export function describeResolvedToolPath(rawPath: string, resolvedPath: string, ctx: ToolContext): string {
  return `"${rawPath}" resolved to ${resolvedPath} (workDir: ${ctx.workDir}, memoryDir: ${ctx.memoryDir})`
}

export function describeToolPathContext(rawPath: string, resolvedPath: string, ctx: ToolContext): string {
  return [
    `Resolved path: ${resolvedPath}`,
    `Input path: ${rawPath}`,
    `Base path: ${ctx.basePath}`,
    `Memory dir: ${ctx.memoryDir}`,
    `Bundle dir: ${ctx.bundleDir}`,
    `Work dir: ${ctx.workDir}`,
  ].join('\n')
}
