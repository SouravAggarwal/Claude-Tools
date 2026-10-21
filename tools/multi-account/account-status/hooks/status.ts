// The shared shapes and pure helpers: what a session reports, and how the /accounts pane reads it back.
// The terminal dashboard (~/.local/bin/claude-accounts) reads the same files and keeps the same rules.

export type AccountConfig = {
  label?: string
  /** Its own Claude folder, used when it works through claude-ask. */
  configDir: string
  /** The desktop app's Claude folder, for the account the app is signed in to. */
  desktopConfigDir?: string
  desktopApp?: boolean
  worker?: boolean
}
export type ProjectConfig = { folders: string[] }
export type Config = {
  /** The worker claude-ask sends work to; claude-use sets it. */
  active?: string
  accounts: Record<string, AccountConfig>
  projects: Record<string, ProjectConfig>
}

export function roleOf(config: Config, tag: string): string {
  const account = config.accounts[tag]
  const role = account?.desktopApp ? (account.worker ? 'desktop app + worker' : 'desktop app') : 'worker'

  return config.active === tag ? `${role} · ★ active` : role
}

export type RateLimit = { kind: string; percentUsed: number; resetsAt: string | null }

export type SessionStatus = {
  version: 1
  account: string
  sessionId: string
  cwd: string
  project: string | null
  model: string
  kind: 'desktop' | 'terminal' | 'background'
  state: 'working' | 'idle' | 'ended'
  task: string | null
  lastPrompt: string | null
  activity: string | null
  context: { percent: number | null; tokens: number | null; window: number }
  rateLimits: RateLimit[]
  costUsd: number | null
  startedAt: number
  updatedAt: number
}

export const STATUS_DIR = '.claude-accounts/status'
export const CONFIG_FILE = '.claude-accounts/config.json'

// A session whose process stopped sending heartbeats (every 20 s) is gone; an ended one shows for a while.
const GONE_AFTER_MS = 3 * 60 * 1000
const ENDED_SHOWN_MS = 15 * 60 * 1000

export function expandHome(path: string, home: string): string {
  const full = path === '~' ? home : path.startsWith('~/') ? `${home}/${path.slice(2)}` : path

  return full.length > 1 ? full.replace(/\/+$/, '') : full
}

function isInside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(`${folder}/`)
}

export function accountFor(config: Config | null, configDir: string, home: string): string {
  const dir = expandHome(configDir, home)
  const match = Object.entries(config?.accounts ?? {}).find(([, account]) =>
    [account.configDir, account.desktopConfigDir].some(folder => folder !== undefined && expandHome(folder, home) === dir),
  )

  return match ? match[0] : 'unknown'
}

// The project whose folder holds `cwd` most closely: a nested project wins over the one around it.
export function projectFor(config: Config | null, cwd: string, home: string): string | null {
  let best: { name: string; length: number } | null = null

  for (const [name, project] of Object.entries(config?.projects ?? {})) {
    for (const folder of project.folders) {
      const full = expandHome(folder, home)
      if (isInside(cwd, full) && (best === null || full.length > best.length)) {
        best = { name, length: full.length }
      }
    }
  }

  return best?.name ?? null
}

export function shorten(text: string, max: number): string {
  const line = text.split('\n').find(part => part.trim() !== '')?.trim().replace(/\s+/g, ' ') ?? ''

  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function baseName(path: unknown): string {
  return typeof path === 'string' ? (path.split('/').pop() ?? path) : ''
}

export function toolActivity(tool: string, input: Readonly<Record<string, unknown>>): string {
  const text = (value: unknown) => (typeof value === 'string' ? shorten(value, 60) : '')
  const detail =
    tool === 'Bash'
      ? text(input.description) || text(input.command)
      : tool === 'Read' || tool === 'Edit' || tool === 'Write' || tool === 'NotebookEdit'
        ? baseName(input.file_path)
        : tool === 'Agent'
          ? text(input.description)
          : tool === 'Skill'
            ? text(input.skill)
            : tool === 'Grep' || tool === 'Glob'
              ? text(input.pattern)
              : ''

  return detail ? `${tool}: ${detail}` : tool
}

export function isShown(status: SessionStatus, now: number): boolean {
  return status.state === 'ended' ? now - status.updatedAt < ENDED_SHOWN_MS : now - status.updatedAt < GONE_AFTER_MS
}

// An account's limits are the same for all its sessions: take the freshest reading any session made.
export function latestLimits(statuses: readonly SessionStatus[], account: string): { limits: RateLimit[]; at: number } | null {
  const readings = statuses.filter(status => status.account === account && status.rateLimits.length > 0)
  const freshest = readings.sort((a, b) => b.updatedAt - a.updatedAt)[0]

  return freshest ? { limits: freshest.rateLimits, at: freshest.updatedAt } : null
}

export function untilText(iso: string | null, now: number): string {
  if (iso === null) return ''
  const minutes = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)

  return days > 0 ? `resets in ${days}d ${hours}h` : `resets in ${hours}h ${minutes % 60}m`
}

export function agoText(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60000)

  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`
}

export function bar(percent: number, width: number): string {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}
