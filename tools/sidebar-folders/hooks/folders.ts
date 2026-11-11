// Pure helpers for sidebar-folders: the rules file, which folder a chat belongs in, and reading the
// desktop app's answers. Nothing here touches the engine, so the tests can check it directly.

/** One rule: the sidebar folder `name`, and what puts a chat in it. */
export type Rule = {
  name: string
  /** Project folders: a chat whose working folder is one of these, or inside one, matches. */
  projects: string[]
  /** Words: a chat whose title holds one of these (any case) matches. */
  titles: string[]
}

export type Config = {
  /** A chat Claude started from another chat goes into its parent's folder. */
  followParent: boolean
  /** Checked in order; the first that matches wins. */
  rules: Rule[]
}

export const EMPTY_CONFIG: Config = { followParent: true, rules: [] }

/** What the app says about one chat. */
export type SessionInfo = {
  title: string | null
  groupId: string | null
  groupName: string | null
  parentId: string | null
}

export type Group = { id: string; name: string; count: number }

/** What `/folder <args>` asks for. */
export type FolderCommand =
  | { kind: 'show' }
  | { kind: 'clear' }
  | { kind: 'move'; name: string; remember: boolean }

const REMEMBER_FLAG = '--project'

function strings(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() === '' ? [] : [value.trim()]
  if (!Array.isArray(value)) return []

  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
}

/** Reads the rules file's text. A missing, empty or broken file means no rules, never an error. */
export function parseConfig(text: string | null): Config {
  if (text === null || text.trim() === '') return EMPTY_CONFIG
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return EMPTY_CONFIG
  }
  if (typeof raw !== 'object' || raw === null) return EMPTY_CONFIG
  const record = raw as { followParent?: unknown; rules?: unknown }
  const rules: Rule[] = []
  for (const item of Array.isArray(record.rules) ? record.rules : []) {
    if (typeof item !== 'object' || item === null) continue
    const rule = item as { name?: unknown; projects?: unknown; titles?: unknown }
    if (typeof rule.name !== 'string' || rule.name.trim() === '') continue
    rules.push({ name: rule.name.trim(), projects: strings(rule.projects), titles: strings(rule.titles) })
  }

  return { followParent: record.followParent !== false, rules }
}

/** `~` and `~/x` become the home folder; trailing slashes go. */
export function expandHome(path: string, home: string): string {
  const expanded = path === '~' ? home : path.startsWith('~/') ? `${home}${path.slice(1)}` : path

  return expanded.length > 1 ? expanded.replace(/\/+$/, '') : expanded
}

/** True when `cwd` is `folder` or inside it. */
export function isInside(cwd: string, folder: string): boolean {
  if (folder === '') return false
  if (folder === '/') return cwd.startsWith('/')
  const clean = cwd.replace(/\/+$/, '')

  return clean === folder || clean.startsWith(`${folder}/`)
}

/**
 * The folder a chat belongs in, or null. Rules are checked in order and the first match wins. With no
 * title yet, only project rules can match.
 */
export function pickFolder(config: Config, chat: { cwd: string; title: string | null; home: string }): string | null {
  const title = chat.title?.toLowerCase() ?? null
  for (const rule of config.rules) {
    if (rule.projects.some(project => isInside(chat.cwd, expandHome(project, chat.home)))) return rule.name
    if (title !== null && rule.titles.some(word => title.includes(word.toLowerCase()))) return rule.name
  }

  return null
}

/** The rules file with a project rule added for `name`, keeping everything else in it. */
export function withProjectRule(text: string | null, name: string, project: string): string {
  let raw: Record<string, unknown> = {}
  try {
    const parsed: unknown = text === null || text.trim() === '' ? {} : JSON.parse(text)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) raw = { ...(parsed as Record<string, unknown>) }
  } catch {
    // A broken file is replaced by one that works; the old text is not kept.
  }
  const rules = Array.isArray(raw.rules) ? [...(raw.rules as unknown[])] : []
  const index = rules.findIndex(
    item => typeof item === 'object' && item !== null && sameName((item as { name?: unknown }).name, name),
  )
  if (index === -1) {
    rules.push({ name, projects: [project] })
  } else {
    const rule = { ...(rules[index] as Record<string, unknown>) }
    const projects = strings(rule.projects)
    if (!projects.includes(project)) rule.projects = [...projects, project]
    rules[index] = rule
  }

  return `${JSON.stringify({ followParent: true, ...raw, rules }, null, 2)}\n`
}

export function sameName(a: unknown, b: string): boolean {
  return typeof a === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** `/folder` with nothing shows; `none` takes the chat out; anything else is a folder name. */
export function parseCommand(args: string): FolderCommand {
  const words = args.trim().split(/\s+/).filter(word => word !== '')
  const remember = words.includes(REMEMBER_FLAG)
  const name = words.filter(word => word !== REMEMBER_FLAG).join(' ')
  if (name === '') return { kind: 'show' }
  if (name.toLowerCase() === 'none') return { kind: 'clear' }

  return { kind: 'move', name: name.slice(0, 200), remember }
}

/** The JSON an MCP answer carries: its structured result, or the first text block that parses. */
export function jsonOf(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) return null
  const answer = result as { structuredContent?: unknown; content?: unknown }
  if (answer.structuredContent !== undefined && answer.structuredContent !== null) return answer.structuredContent
  for (const block of Array.isArray(answer.content) ? answer.content : []) {
    const text = typeof block === 'object' && block !== null ? (block as { text?: unknown }).text : undefined
    if (typeof text !== 'string') continue
    try {
      return JSON.parse(text)
    } catch {
      // Not JSON (for example "No custom sidebar groups."): try the next block.
    }
  }

  return null
}

export function sessionOf(result: unknown): SessionInfo {
  const raw = jsonOf(result)
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const group = typeof record.group === 'object' && record.group !== null ? (record.group as Record<string, unknown>) : null
  const title = typeof record.title === 'string' && record.title.trim() !== '' ? record.title : null

  return {
    title,
    groupId: typeof group?.id === 'string' ? group.id : null,
    groupName: typeof group?.name === 'string' ? group.name : null,
    parentId: typeof record.parentSessionId === 'string' && record.detached !== true ? record.parentSessionId : null,
  }
}

export function groupsOf(result: unknown): Group[] {
  const raw = jsonOf(result)
  const list = Array.isArray(raw) ? raw : []

  return list.flatMap(item => {
    if (typeof item !== 'object' || item === null) return []
    const group = item as { id?: unknown; name?: unknown; session_count?: unknown }
    if (typeof group.id !== 'string' || typeof group.name !== 'string') return []

    return [{ id: group.id, name: group.name, count: typeof group.session_count === 'number' ? group.session_count : 0 }]
  })
}

/** The id a create_group answer names, as JSON or in its text. */
export function createdIdOf(result: unknown): string | null {
  const raw = jsonOf(result)
  if (typeof raw === 'string' && raw !== '') return raw
  if (typeof raw === 'object' && raw !== null) {
    const id = (raw as { id?: unknown }).id
    if (typeof id === 'string' && id !== '') return id
  }

  return null
}

/** The `/folder` answer when nothing is asked: where this chat is, and the folders there are. */
export function summary(current: string | null, groups: Group[], rulesPath: string): string {
  const here = current === null ? 'This chat is not in a folder.' : `This chat is in "${current}".`
  const list =
    groups.length === 0
      ? 'There are no folders yet.'
      : `Folders: ${groups.map(group => `${group.name} (${group.count})`).join(', ')}.`

  return [
    here,
    list,
    'Move this chat: /folder <name>. Also send new chats from this project there: /folder <name> --project. Take it out: /folder none.',
    `Rules file: ${rulesPath}`,
  ].join('\n')
}
