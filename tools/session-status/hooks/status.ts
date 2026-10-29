// The pure half of session-status: the one rule that names a session's state, the sidebar marker, and
// how the /sessions board reads the status files back. register.tsx feeds it what the session did.

export type State = 'working' | 'needs-you' | 'done' | 'failed' | 'idle'

export type EndReason = 'answer' | 'aborted' | 'refusal' | 'error'

/** What the session has done so far, as the hooks saw it. */
export type Facts = {
  /** A main-loop turn is running now. */
  turnRunning: boolean
  /** How the last main-loop turn ended; null before the first and while one runs. */
  lastEnd: EndReason | null
  /** What an open AskUserQuestion or ExitPlanMode is waiting on; null when none is open. */
  asking: string | null
  /** The `ask` of a wrap_up this turn; null when there was none. */
  wrapAsk: string | null
  /** wrap_up ran this turn with no ask: the turn's work is done. */
  wrappedUp: boolean
  /** Helper agents and background commands that started and have not finished. */
  helpers: number
  steps: { done: number; total: number }
}

export type Verdict = { state: State; waitingReason: string | null }

// One rule, checked in this order: failed, needs you, working, done, idle.
export function decide(facts: Facts): Verdict {
  const ended = !facts.turnRunning

  if (ended && facts.lastEnd === 'error') return { state: 'failed', waitingReason: 'Ended with an error' }
  if (ended && facts.lastEnd === 'refusal') return { state: 'failed', waitingReason: 'Claude refused' }
  if (facts.asking !== null) return { state: 'needs-you', waitingReason: facts.asking }
  if (ended && facts.lastEnd === 'answer' && facts.wrapAsk !== null) return { state: 'needs-you', waitingReason: facts.wrapAsk }
  if (facts.turnRunning || facts.helpers > 0) return { state: 'working', waitingReason: null }

  if (ended && facts.lastEnd === 'answer') {
    const left = facts.steps.total - facts.steps.done

    // A turn that stopped with steps left (and nothing still running for it) is waiting on the person.
    return facts.wrappedUp || left <= 0
      ? { state: 'done', waitingReason: null }
      : { state: 'needs-you', waitingReason: `Stopped with ${left} of ${facts.steps.total} steps left` }
  }

  return { state: 'idle', waitingReason: null }
}

export type StatusFile = {
  version: 1
  /** Claude Code's own id for the session. */
  sessionId: string
  /** The desktop app's id (`local_<uuid>`); null outside the app. */
  hostSessionId: string | null
  state: State
  steps: { done: number; total: number; current: string | null }
  helpersRunning: number
  waitingReason: string | null
  /** The session's title without the marker, when the app told us. */
  title: string | null
  cwd: string
  project: string
  /** The multi-account tag, when that tool reports this session. */
  account: string | null
  stateSince: number
  updatedAt: number
  /** The session's process said goodbye. */
  ended: boolean
  /** The last whole title this add-on wrote to the sidebar, so a reload knows it; absent in older files. */
  lastWrittenTitle?: string | null
}

export const STATUS_DIR = '.claude-session-status'
export const ACCOUNT_STATUS_DIR = '.claude-accounts/status'

export function fileNameFor(sessionId: string, hostSessionId: string | null): string {
  return `${(hostSessionId ?? sessionId).replace(/[^\w.-]/g, '_')}.json`
}

export function projectOf(cwd: string): string {
  return cwd.split('/').filter(Boolean).pop() ?? cwd
}

export function shorten(text: string, max: number): string {
  const line = text.split('\n').find(part => part.trim() !== '')?.trim().replace(/\s+/g, ' ') ?? ''

  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

// ── The sidebar marker ──────────────────────────────────────────────────────

export type MarkerSet = 'A' | 'B' | 'C' | 'off'

const MARKERS: Record<Exclude<MarkerSet, 'off'>, Record<Exclude<State, 'idle'>, string>> = {
  A: { working: '⏳', 'needs-you': '💬', done: '✅', failed: '⚠️' },
  B: { working: '🔹', 'needs-you': '🔸', done: '✔️', failed: '❗' },
  C: { working: '🔵', 'needs-you': '🟡', done: '🟢', failed: '🔴' },
}

export function markerSetOf(value: unknown): MarkerSet {
  return value === 'B' || value === 'C' || value === 'off' ? value : 'A'
}

// "⏳ 4/7": the marker, then the step count while there is one; done needs no count, idle no marker.
export function markerLabel(set: MarkerSet, state: State, steps: { done: number; total: number }): string {
  if (set === 'off' || state === 'idle') return ''
  const count = steps.total > 0 && state !== 'done' ? ` ${steps.done}/${steps.total}` : ''

  return `${MARKERS[set][state]}${count}`
}

// Every glyph of every set, so a title marked under another set is cleaned too.
const GLYPHS = [...new Set(Object.values(MARKERS).flatMap(set => Object.values(set)))]
  .map(glyph => glyph.replace(/️/g, ''))
  .sort((a, b) => b.length - a.length)
const OLD_MARKER = new RegExp(`^(?:(?:${GLYPHS.join('|')})\\uFE0F?(?: \\d+/\\d+)?\\s+)+`, 'u')

export function stripMarker(title: string): string {
  return title.replace(OLD_MARKER, '')
}

export function withMarker(title: string, label: string): string {
  const base = stripMarker(title)

  return label === '' ? base : `${label} ${base}`
}

// ── Whose name the chat has ─────────────────────────────────────────────────

/** Who named the chat, from the app's own record of it: the person, someone else, or unknown (no record). */
export type TitleSource = 'user' | 'other' | 'unknown'

export type RecordEnv = {
  execPath: string | undefined
  accountId: string | undefined
  organizationId: string | undefined
  hostSessionId: string | undefined
}

// The desktop app keeps each chat's record at
// <app data>/claude-code-sessions/<account>/<organization>/<host session>.json, and its data folder is where
// it keeps Claude Code (`CLAUDE_CODE_EXECPATH`), cut before "/claude-code/". Only plain ids are used.
export function recordPath(env: RecordEnv): string | null {
  const { execPath, accountId, organizationId, hostSessionId } = env
  const cut = execPath?.indexOf('/claude-code/') ?? -1
  const plain = (id: string | undefined): id is string => typeof id === 'string' && /^[\w-]+$/.test(id)

  if (!execPath || cut <= 0 || !plain(accountId) || !plain(organizationId) || !plain(hostSessionId)) return null

  return `${execPath.slice(0, cut)}/claude-code-sessions/${accountId}/${organizationId}/${hostSessionId}.json`
}

// Reads only `titleSource` from the record: "user" when the person named the chat. Anything else in the
// record is left alone. Text that is not a JSON object is unknown.
export function titleSourceOf(text: string): TitleSource {
  try {
    const record = JSON.parse(text) as unknown
    if (typeof record !== 'object' || record === null || Array.isArray(record)) return 'unknown'

    return (record as { titleSource?: unknown }).titleSource === 'user' ? 'user' : 'other'
  } catch {
    return 'unknown'
  }
}

// The app asks the person before renaming a chat they named, and no setting can answer for them, so a
// chat they named is never renamed. Without the record, only a title this add-on wrote last (or a chat it
// never wrote) is renamed: any other title means someone renamed it.
export function mayRename(source: TitleSource, current: string, lastWritten: string | null): boolean {
  if (source === 'user') return false
  if (source === 'other') return true

  return lastWritten === null || current === lastWritten
}

// get_session's answer, read defensively: structured content first, then JSON in a text block.
export function titleFromSession(result: unknown): string | null {
  const pick = (value: unknown): string | null => {
    if (typeof value !== 'object' || value === null) return null
    const record = value as { title?: unknown; session?: unknown }
    if (typeof record.title === 'string') return record.title

    return pick(record.session)
  }
  const answer = typeof result === 'object' && result !== null ? (result as { structuredContent?: unknown; content?: unknown }) : {}
  const structured = pick(answer.structuredContent)
  if (structured !== null) return structured

  for (const block of Array.isArray(answer.content) ? answer.content : []) {
    const text = typeof block === 'object' && block !== null ? (block as { text?: unknown }).text : undefined
    if (typeof text !== 'string') continue
    try {
      const found = pick(JSON.parse(text))
      if (found !== null) return found
    } catch {
      const line = /"?title"?\s*[:=]\s*"?([^"\n]+)"?/i.exec(text)
      if (line?.[1]) return line[1].trim()
    }
  }

  return null
}

// ── The /sessions board ─────────────────────────────────────────────────────

// Heartbeats come every 30 s: a working session silent for 2 minutes has lost its process.
const GONE_AFTER_MS = 2 * 60 * 1000
const SHOWN_FOR_MS = 24 * 60 * 60 * 1000

export const BOARD_ORDER: readonly State[] = ['needs-you', 'working', 'done', 'failed', 'idle']

export const LABELS: Record<State, string> = {
  working: 'Working',
  'needs-you': 'Needs you',
  done: 'Done',
  failed: 'Failed',
  idle: 'Idle',
}

/** The app's dark background takes the design's colours; the terminal gets darker ones that read on light. */
export const COLORS: Record<'desktop' | 'terminal', Record<State, string>> = {
  desktop: { working: '#9592fb', 'needs-you': '#f0a43c', done: '#3fcca2', failed: '#f27485', idle: '#6f737e' },
  terminal: { working: '#5a55d6', 'needs-you': '#b06a00', done: '#13805f', failed: '#c4314b', idle: '#6f737e' },
}

export const NEEDS_YOU_ROW = '#f0a43c1f'

export type BoardRow = StatusFile & { shownState: State; isGone: boolean }

export function boardRows(files: readonly StatusFile[], now: number): BoardRow[] {
  return files
    .filter(file => now - file.updatedAt < SHOWN_FOR_MS)
    .map(file => {
      const isGone = file.state === 'working' && (file.ended || now - file.updatedAt > GONE_AFTER_MS)

      return { ...file, isGone, shownState: isGone ? ('idle' as const) : file.state }
    })
    .sort(
      (a, b) =>
        BOARD_ORDER.indexOf(a.shownState) - BOARD_ORDER.indexOf(b.shownState) || b.stateSince - a.stateSince,
    )
}

export function detailOf(row: BoardRow): string {
  if (row.isGone) return 'Not running'
  const helpers = row.helpersRunning > 0 ? `${row.helpersRunning} helper${row.helpersRunning === 1 ? '' : 's'} running` : ''
  const main = row.waitingReason ?? (row.state === 'working' ? row.steps.current : null) ?? ''

  return [main, helpers].filter(Boolean).join(' · ')
}

export function durationText(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`

  return `${Math.floor(seconds / 86400)}d`
}

export function textBar(done: number, total: number, width: number): string {
  const filled = total === 0 ? 0 : Math.max(0, Math.min(width, Math.round((done / total) * width)))

  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

export function svgBar(done: number, total: number, color: string, width: number, height: number): string {
  const fill = total === 0 ? 0 : Math.round((done / total) * width)
  const radius = height / 2

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" rx="${radius}" fill="#8a8a8a" fill-opacity="0.3"/>`,
    fill > 0 ? `<rect width="${fill}" height="${height}" rx="${radius}" fill="${color}"/>` : '',
    '</svg>',
  ].join('')
}

// A working session's dot breathes; the others hold still.
export function svgDot(color: string, isPulsing: boolean): string {
  const pulse = isPulsing
    ? '<animate attributeName="opacity" values="1;0.35;1" dur="1.6s" repeatCount="indefinite"/>'
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="${color}">${pulse}</circle></svg>`
}

// The desktop app opens a chat from its own link; only an id of plain letters, digits, `_` and `-` is used.
export function openArgv(hostSessionId: string | null): string[] | null {
  return hostSessionId !== null && /^[\w-]+$/.test(hostSessionId)
    ? ['open', `claude://claude.ai/epitaxy/${hostSessionId}`]
    : null
}
