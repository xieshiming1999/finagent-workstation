import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { TaskStatus } from './background-task'

export type TeamMemberStatus = TaskStatus | 'planned' | 'detached'

export interface TeamMember {
  id: string
  name: string
  role?: string
  description: string
  prompt?: string
  taskId?: string
  status: TeamMemberStatus
  createdAt: string
  updatedAt: string
  lastMessageAt?: string
  lastError?: string
}

export interface TeamRecord {
  name: string
  description?: string
  status: 'active' | 'deleted'
  createdAt: string
  updatedAt: string
  deletedAt?: string
  members: TeamMember[]
}

interface TeamStateFile {
  version: 1
  teams: TeamRecord[]
}

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeTeamName(name: string): string {
  return name.trim()
}

function normalizeMemberName(name: string): string {
  return name.trim()
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function atomicWriteJson(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
  renameSync(tmp, filePath)
}

export class TeamRegistry {
  private teams = new Map<string, TeamRecord>()
  private statePath: string | null = null

  configure(memoryDir: string): void {
    this.statePath = join(memoryDir, 'teams', 'index.json')
    this.load()
  }

  load(): void {
    if (!this.statePath || !existsSync(this.statePath)) return
    try {
      const parsed = JSON.parse(readFileSync(this.statePath, 'utf-8')) as Partial<TeamStateFile>
      this.teams.clear()
      for (const team of parsed.teams ?? []) {
        if (!team?.name) continue
        const normalized: TeamRecord = {
          name: normalizeTeamName(team.name),
          description: team.description,
          status: team.status === 'deleted' ? 'deleted' : 'active',
          createdAt: team.createdAt ?? nowIso(),
          updatedAt: team.updatedAt ?? nowIso(),
          deletedAt: team.deletedAt,
          members: Array.isArray(team.members) ? team.members.map((m, idx) => ({
            id: m.id || `${team.name}-${idx + 1}`,
            name: normalizeMemberName(m.name || m.description || `member-${idx + 1}`),
            role: m.role,
            description: m.description || m.name || `member-${idx + 1}`,
            prompt: m.prompt,
            taskId: m.taskId,
            status: m.status ?? 'planned',
            createdAt: m.createdAt ?? nowIso(),
            updatedAt: m.updatedAt ?? nowIso(),
            lastMessageAt: m.lastMessageAt,
            lastError: m.lastError,
          })) : [],
        }
        this.teams.set(normalized.name, normalized)
      }
    } catch {
      this.teams.clear()
    }
  }

  save(): void {
    if (!this.statePath) return
    atomicWriteJson(this.statePath, {
      version: 1,
      teams: Array.from(this.teams.values()),
    } satisfies TeamStateFile)
  }

  createTeam(name: string, description?: string): TeamRecord {
    const teamName = normalizeTeamName(name)
    if (!teamName) throw new Error('team name is required')
    const existing = this.getTeam(teamName, { includeDeleted: true })
    const ts = nowIso()
    if (existing) {
      existing.description = description ?? existing.description
      existing.status = 'active'
      existing.deletedAt = undefined
      existing.updatedAt = ts
      this.save()
      return existing
    }
    const team: TeamRecord = {
      name: teamName,
      description,
      status: 'active',
      createdAt: ts,
      updatedAt: ts,
      members: [],
    }
    this.teams.set(team.name, team)
    this.save()
    return team
  }

  addPlannedMember(teamName: string, opts: { name: string; role?: string; description: string; prompt?: string }): TeamMember {
    return this.addOrUpdateMember(teamName, {
      ...opts,
      status: 'planned',
    })
  }

  registerRunningMember(teamName: string, opts: {
    name: string
    role?: string
    description: string
    prompt?: string
    taskId: string
    status?: TeamMemberStatus
  }): TeamMember {
    return this.addOrUpdateMember(teamName, {
      ...opts,
      status: opts.status ?? 'pending',
    })
  }

  private addOrUpdateMember(teamName: string, opts: {
    name: string
    role?: string
    description: string
    prompt?: string
    taskId?: string
    status: TeamMemberStatus
  }): TeamMember {
    const team = this.requireActiveTeam(teamName)
    const memberName = normalizeMemberName(opts.name)
    if (!memberName) throw new Error('member name is required')
    const ts = nowIso()
    let member = team.members.find((m) =>
      (opts.taskId && m.taskId === opts.taskId) || sameName(m.name, memberName)
    )
    if (!member) {
      member = {
        id: `${team.name}:${memberName}:${Date.now()}`,
        name: memberName,
        role: opts.role,
        description: opts.description,
        prompt: opts.prompt,
        taskId: opts.taskId,
        status: opts.status,
        createdAt: ts,
        updatedAt: ts,
      }
      team.members.push(member)
    } else {
      member.name = memberName
      member.role = opts.role ?? member.role
      member.description = opts.description
      member.prompt = opts.prompt ?? member.prompt
      member.taskId = opts.taskId ?? member.taskId
      member.status = opts.status
      member.updatedAt = ts
    }
    team.updatedAt = ts
    this.save()
    return member
  }

  updateMemberStatusByTask(taskId: string, status: TeamMemberStatus, error?: string): TeamMember | null {
    for (const team of this.teams.values()) {
      const member = team.members.find((m) => m.taskId === taskId)
      if (!member) continue
      member.status = status
      member.updatedAt = nowIso()
      if (error) member.lastError = error
      team.updatedAt = member.updatedAt
      this.save()
      return member
    }
    return null
  }

  markMemberMessaged(taskId: string): void {
    for (const team of this.teams.values()) {
      const member = team.members.find((m) => m.taskId === taskId)
      if (!member) continue
      member.lastMessageAt = nowIso()
      member.updatedAt = member.lastMessageAt
      team.updatedAt = member.lastMessageAt
      this.save()
      return
    }
  }

  getTeam(name: string, opts?: { includeDeleted?: boolean }): TeamRecord | null {
    const teamName = normalizeTeamName(name)
    for (const team of this.teams.values()) {
      if (!sameName(team.name, teamName)) continue
      if (!opts?.includeDeleted && team.status === 'deleted') return null
      return team
    }
    return null
  }

  requireActiveTeam(name: string): TeamRecord {
    const team = this.getTeam(name)
    if (!team) throw new Error(`Team not found: ${name}. Create it with TeamCreate before assigning agents.`)
    return team
  }

  listTeams(opts?: { includeDeleted?: boolean }): TeamRecord[] {
    return Array.from(this.teams.values()).filter((team) => opts?.includeDeleted || team.status !== 'deleted')
  }

  findMemberTaskId(target: string): string | null {
    const raw = target.trim()
    const slash = raw.includes('/') ? raw.split('/') : null
    for (const team of this.listTeams()) {
      if (slash && !sameName(team.name, slash[0])) continue
      for (const member of team.members) {
        if (!member.taskId) continue
        if (member.taskId === raw) return member.taskId
        const candidate = slash ? slash.slice(1).join('/') : raw
        if (sameName(member.name, candidate) || sameName(member.role ?? '', candidate) || sameName(member.description, candidate)) {
          return member.taskId
        }
      }
    }
    return null
  }

  deleteTeam(name: string): TeamRecord {
    const team = this.requireActiveTeam(name)
    const ts = nowIso()
    team.status = 'deleted'
    team.deletedAt = ts
    team.updatedAt = ts
    for (const member of team.members) {
      if (member.status === 'pending' || member.status === 'running') {
        member.status = 'killed'
        member.updatedAt = ts
        member.lastError = 'Team deleted'
      }
    }
    this.save()
    return team
  }
}
