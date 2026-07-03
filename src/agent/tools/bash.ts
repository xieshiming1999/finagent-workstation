import { spawn, execSync } from 'child_process'
import { existsSync } from 'fs'
import type { Tool, ToolContext } from '../tool'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_TIMEOUT_MS = 600_000
const MAX_OUTPUT_CHARS = 30_000

const DESTRUCTIVE_WARNINGS: Record<string, string> = {
  'git reset --hard': 'may discard uncommitted changes',
  'git checkout .': 'may discard uncommitted changes',
  'git clean -f': 'may delete untracked files',
  'git push --force': 'may overwrite remote history',
  'git push -f': 'may overwrite remote history',
  'rm -rf': 'may recursively force-remove files',
  'rm -r': 'may recursively remove files',
  'DROP TABLE': 'may permanently delete database table',
  'DELETE FROM': 'may permanently delete database records',
  'kubectl delete': 'may delete Kubernetes resources',
  'terraform destroy': 'may destroy infrastructure',
}

interface BashResult {
  stdout: string
  stderr: string
  exitCode: number
  timedOut: boolean
  newCwd: string | null
}

export class BashTool implements Tool {
  name = 'Bash'
  description = `Executes a given bash command and returns its output.

The working directory persists between commands, but shell state does not. The shell environment is initialized from the user's profile (bash or zsh).

IMPORTANT: Avoid using this tool to run \`cat\`, \`head\`, \`tail\`, \`sed\`, \`awk\`, or \`echo\` commands, unless explicitly instructed. Instead, use the appropriate dedicated tool:
 - Read files: Use Read (NOT cat/head/tail)
 - Edit files: Use Edit (NOT sed/awk)
 - Write files: Use Write (NOT echo >/cat <<EOF)
 - File search: Use Glob (NOT find or ls)
 - Content search: Use Grep (NOT grep or rg)
 - Communication: Output text directly (NOT echo/printf)

# Instructions
 - If your command will create new directories or files, first run \`ls\` to verify the parent directory exists.
 - Always quote file paths that contain spaces with double quotes.
 - Try to maintain your current working directory by using absolute paths and avoiding \`cd\`. You may use \`cd\` if explicitly requested.
 - You may specify an optional timeout in milliseconds (up to 600000ms / 10 minutes). Default: 120000ms (2 minutes).
 - You can use the \`run_in_background\` parameter to run long commands in the background.
 - When issuing multiple commands:
   - Independent commands: make multiple Bash tool calls in parallel.
   - Sequential commands: use \`&&\` to chain them.
   - Use \`;\` only when you don't care if earlier commands fail.
   - DO NOT use newlines to separate commands.
 - For git commands:
   - Prefer new commits over amending existing commits.
   - Before destructive operations (git reset --hard, git push --force), consider safer alternatives.
   - Never skip hooks (--no-verify) or bypass signing unless explicitly asked.
   - NEVER force-push to main/master.
 - Avoid unnecessary \`sleep\` commands. Use \`run_in_background\` for long-running processes.
 - NEVER run destructive commands (rm -rf /, mkfs, dd to devices) — they are hardline blocked.

# Committing changes with git

Only create commits when requested by the user. When asked to commit:

Git Safety Protocol:
- NEVER update the git config
- NEVER run destructive git commands unless explicitly requested
- NEVER skip hooks (--no-verify, --no-gpg-sign) unless explicitly requested
- CRITICAL: Always create NEW commits rather than amending. After hook failure, fix + re-stage + NEW commit.
- Prefer adding specific files by name rather than "git add -A" or "git add ."
- NEVER commit unless explicitly asked

Steps:
1. Run git status + git diff + git log (in parallel) to understand current state
2. Analyze changes, draft commit message (focus on "why" not "what")
3. Stage files + create commit. ALWAYS use HEREDOC for commit message:
   git commit -m "$(cat <<'EOF'
   Commit message here.

   Co-Authored-By: Claude <noreply@anthropic.com>
   EOF
   )"
4. If pre-commit hook fails: fix the issue and create a NEW commit (never --amend)

# Creating pull requests

Use gh command for ALL GitHub tasks. When creating a PR:
1. Run git status + git diff + git log (understand full branch history)
2. Draft PR title (<70 chars) and body
3. Push + create PR:
   gh pr create --title "title" --body "$(cat <<'EOF'
   ## Summary
   <bullet points>

   ## Test plan
   [checklist]
   EOF
   )"

# Other operations
- View PR comments: gh api repos/foo/bar/pulls/123/comments`
  isReadOnly = false
  inputSchema = {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      timeout: { type: 'number', description: `Optional timeout in milliseconds (max ${MAX_TIMEOUT_MS})` },
      description: { type: 'string', description: 'Clear, concise description of what this command does' },
    },
    required: ['command'],
  }

  private cwd: string | null = null

  onProgress: ((toolUseId: string, output: string, elapsedMs: number) => void) | null = null

  validateInput(input: Record<string, unknown>): string | null {
    const command = input.command as string | undefined
    if (!command?.trim()) return 'command is required and must not be empty.'
    const timeout = input.timeout as number | undefined
    if (timeout != null && timeout > MAX_TIMEOUT_MS) {
      return `timeout must not exceed ${MAX_TIMEOUT_MS} ms (${Math.floor(MAX_TIMEOUT_MS / 60_000)} minutes).`
    }
    return null
  }

  async call(id: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const command = String(input.command)
    const timeoutMs = Number(input.timeout ?? DEFAULT_TIMEOUT_MS)

    const warning = getDestructiveWarning(command)
    if (warning) console.warn(`Bash WARNING: ${warning} — ${command}`)

    const shell = findShell()
    const cwd = this.cwd ?? ctx.workDir ?? ctx.basePath

    const start = Date.now()
    const result = await this.execute(shell, command, cwd, timeoutMs, id)
    const elapsed = Date.now() - start

    if (result.newCwd) this.cwd = result.newCwd

    return this.buildResult(command, result, timeoutMs, warning, elapsed)
  }

  private async execute(shell: string, command: string, cwd: string, timeoutMs: number, toolUseId: string): Promise<BashResult> {
    const wrappedCommand = `${command}; __exit=$?; pwd -P; exit $__exit`

    return new Promise((resolve) => {
      const child = spawn(shell, ['-c', wrappedCommand], {
        cwd,
        timeout: timeoutMs,
        env: {
          ...process.env,
          GIT_EDITOR: 'true',
          LANG: 'en_US.UTF-8',
        },
      })

      const stdoutChunks: string[] = []
      const stderrChunks: string[] = []
      let timedOut = false
      const startTime = Date.now()

      child.stdout.on('data', (data) => stdoutChunks.push(data.toString()))
      child.stderr.on('data', (data) => stderrChunks.push(data.toString()))

      // Progress reporting
      let progressTimer: ReturnType<typeof setInterval> | null = null
      if (this.onProgress) {
        progressTimer = setInterval(() => {
          const elapsed = Date.now() - startTime
          if (elapsed >= 2000) {
            const current = stdoutChunks.join('') + stderrChunks.join('')
            if (current) {
              this.onProgress!(toolUseId, truncateOutput(current), elapsed)
            }
          }
        }, 3000)
      }

      child.on('close', (code, signal) => {
        if (progressTimer) clearInterval(progressTimer)
        if (signal === 'SIGTERM' || signal === 'SIGKILL') timedOut = true

        let stdout = stdoutChunks.join('')
        let newCwd: string | null = null

        // Extract new cwd from pwd -P output (last line)
        if (!timedOut && stdout) {
          const lines = stdout.split('\n')
          while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop()
          if (lines.length > 0 && lines[lines.length - 1].startsWith('/')) {
            const candidate = lines.pop()!.trim()
            if (existsSync(candidate)) newCwd = candidate
          }
          stdout = lines.join('\n')
        }

        resolve({
          stdout,
          stderr: stderrChunks.join(''),
          exitCode: timedOut ? -1 : (code ?? -1),
          timedOut,
          newCwd,
        })
      })

      child.on('error', (err) => {
        if (progressTimer) clearInterval(progressTimer)
        resolve({
          stdout: '',
          stderr: `Error: ${err.message}`,
          exitCode: -1,
          timedOut: false,
          newCwd: null,
        })
      })
    })
  }

  private buildResult(command: string, result: BashResult, timeoutMs: number, warning: string | null, elapsedMs: number): string {
    const parts: string[] = []
    const timeStr = elapsedMs >= 1000 ? `${(elapsedMs / 1000).toFixed(1)}s` : `${elapsedMs}ms`

    if (warning) parts.push(`⚠️ Warning: ${warning}`)
    if (result.stdout) parts.push(result.stdout)
    if (result.stderr) parts.push(result.stderr)

    if (result.timedOut) {
      parts.push(`\n(Command timed out after ${Math.floor(timeoutMs / 1000)}s and was killed)`)
      return truncateOutput(parts.join('\n'))
    }

    const exitInfo = interpretExitCode(command, result.exitCode)
    if (exitInfo) parts.push(exitInfo)

    const content = parts.join('\n')
    if (!content.trim()) return `(No output, completed in ${timeStr})`

    return `${truncateOutput(content)}\n(${timeStr})`
  }
}

function findShell(): string {
  const envShell = process.env.SHELL
  if (envShell && existsSync(envShell)) return envShell
  if (process.platform === 'darwin' && existsSync('/bin/zsh')) return '/bin/zsh'
  return '/bin/bash'
}

function getDestructiveWarning(command: string): string | null {
  for (const [pattern, warning] of Object.entries(DESTRUCTIVE_WARNINGS)) {
    if (command.includes(pattern)) return warning
  }
  return null
}

function interpretExitCode(command: string, exitCode: number): string | null {
  if (exitCode === 0) return null
  const cmd = command.trim().split(' ')[0].split('/').pop() ?? ''
  if (cmd === 'grep' && exitCode === 1) return '(grep: no matches found)'
  if (cmd === 'diff' && exitCode === 1) return '(diff: files differ)'
  return `(Exit code: ${exitCode})`
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output
  return `${output.slice(0, MAX_OUTPUT_CHARS)}\n\n(Output truncated: ${output.length} chars exceeded limit of ${MAX_OUTPUT_CHARS} chars)`
}
