// Pure helpers for sidebar-folders: the rules file, which folder a chat belongs in, and reading the
// desktop app's answers. Nothing here touches the engine, so the tests can check it directly.

/** One rule: the sidebar folder `name`, and what puts a chat in it. */
export type Rule = {
  name: string
  /** The folder's id, saved the first time the rule finds it, so a rename in the sidebar keeps the rule. */
  id: string | null
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
    const rule = item as { name?: unknown; id?: unknown; projects?: unknown; titles?: unknown }
    if (typeof rule.name !== 'string' || rule.name.trim() === '') continue
    rules.push({
      name: rule.name.trim(),
      id: typeof rule.id === 'string' && rule.id !== '' ? rule.id : null,
      projects: strings(rule.projects),
      titles: strings(rule.titles),
    })
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
 * The rule a chat belongs to, or null. Rules are checked in order and the first match wins. With no
 * title yet, only project rules can match.
 */
export function pickRule(config: Config, chat: { cwd: string; title: string | null; home: string }): Rule | null {
  const title = chat.title?.toLowerCase() ?? null
  for (const rule of config.rules) {
    if (rule.projects.some(project => isInside(chat.cwd, expandHome(project, chat.home)))) return rule
    if (title !== null && rule.titles.some(word => title.includes(word.toLowerCase()))) return rule
  }

  return null
}

/**
 * The folder for a rule or a typed name: the one with the rule's saved id, else the same name (any case),
 * else the one folder whose name is the same once leading emoji and symbols go ("Garden" finds
 * "🟢 Garden", but "C" never finds "C++"). Undefined when there is none, or the loose match is not unique.
 */
export function findGroup(groups: Group[], name: string, id: string | null = null): Group | undefined {
  const byId = id === null ? undefined : groups.find(group => group.id === id)
  if (byId !== undefined) return byId
  const byName = groups.find(group => sameName(group.name, name))
  if (byName !== undefined) return byName
  const loose = looseName(name)
  const alike = loose === '' ? [] : groups.filter(group => looseName(group.name) === loose)

  return alike.length === 1 ? alike[0] : undefined
}

function looseName(name: string): string {
  return name.replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase()
}

type RawRules = { raw: Record<string, unknown>; rules: unknown[] }

// The rules file as plain JSON, so a write keeps everything in it. Null when there is a file that does not
// parse: it may be half written by another chat, or broken by hand, and is never written over.
function rawRules(text: string | null): RawRules | null {
  if (text === null || text.trim() === '') return { raw: {}, rules: [] }
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const raw = parsed as Record<string, unknown>

    return { raw, rules: Array.isArray(raw.rules) ? [...(raw.rules as unknown[])] : [] }
  } catch {
    return null
  }
}

function fieldOf(item: unknown, key: string): unknown {
  return typeof item === 'object' && item !== null ? (item as Record<string, unknown>)[key] : undefined
}

// The rule for this folder: the one with its id, else the first one of that name with no id yet.
function ruleIndex(rules: unknown[], name: string, id: string | null): number {
  const byId = id === null ? -1 : rules.findIndex(item => fieldOf(item, 'id') === id)
  if (byId !== -1) return byId

  return rules.findIndex(item => typeof fieldOf(item, 'id') !== 'string' && sameName(fieldOf(item, 'name'), name))
}

/**
 * The rules file with the folder id saved in `rule`, so renaming the folder in the sidebar keeps the rule.
 * The rule's name stays as written. Null when there is nothing to save or the file cannot be read.
 */
export function withRuleFolder(text: string | null, rule: { name: string; id: string | null }, groupId: string): string | null {
  if (rule.id === groupId) return null
  const file = rawRules(text)
  if (file === null) return null
  const index = ruleIndex(file.rules, rule.name, rule.id)
  if (index === -1) return null
  file.rules[index] = { ...(file.rules[index] as Record<string, unknown>), id: groupId }

  return `${JSON.stringify({ ...file.raw, rules: file.rules }, null, 2)}\n`
}

/**
 * The rules file with `project` added to the folder's rule (a new rule if it has none), keeping everything
 * else in it. Throws when there is a file that does not parse, rather than lose the rules in it.
 */
export function withProjectRule(text: string | null, group: { id: string; name: string }, project: string): string {
  const file = rawRules(text)
  if (file === null) throw new Error('the rules file is not valid JSON')
  const index = ruleIndex(file.rules, group.name, group.id)
  if (index === -1) {
    file.rules.push({ name: group.name, id: group.id, projects: [project] })
  } else {
    const rule = file.rules[index] as Record<string, unknown>
    const projects = strings(rule.projects)
    file.rules[index] = { ...rule, id: group.id, projects: projects.includes(project) ? projects : [...projects, project] }
  }

  return `${JSON.stringify({ followParent: true, ...file.raw, rules: file.rules }, null, 2)}\n`
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
