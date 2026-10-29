import type { EngineInterface, Register } from 'claude-code'

import { UPDATE_PLAN, WRAP_UP, progressOf, stepsAfterCall } from './plan'
import type { Step } from './plan'
import {
  ACCOUNT_STATUS_DIR,
  COLORS,
  LABELS,
  NEEDS_YOU_ROW,
  STATUS_DIR,
  boardRows,
  decide,
  detailOf,
  durationText,
  fileNameFor,
  markerLabel,
  markerSetOf,
  mayRename,
  openArgv,
  projectOf,
  recordPath,
  shorten,
  stripMarker,
  svgBar,
  svgDot,
  textBar,
  titleFromSession,
  titleSourceOf,
  withMarker,
} from './status'
import type { BoardRow, Facts, MarkerSet, State, StatusFile, TitleSource } from './status'

const PANE = 'sessions'
const HEARTBEAT_MS = 30_000
const BOARD_REFRESH_MS = 3_000
// The desktop app's own MCP server, which names its chats in the sidebar.
const SESSIONS_SERVER = 'ccd_session_mgmt'
// get_session may fail while the app starts; a refused rename stops renaming at once.
const TITLE_FAILURES_ALLOWED = 3
// How long a hook waits for the sidebar rename before it lets the session go on.
const TITLE_WAIT_MS = 1_500

type Loose = { readonly [field: string]: unknown }

type Live = {
  home: string
  cwd: string
  sessionId: string
  hostSessionId: string | null
  facts: Omit<Facts, 'helpers' | 'steps'>
  steps: Step[]
  state: State
  stateSince: number
  ended: boolean
}

// Module state rather than $.state, which older engines lack: a reload starts it over, and the next
// heartbeat writes a fresh status.
let live: Live | null = null
let markers: MarkerSet = 'A'
/** Subagent loops running now, by agent id. */
const loops = new Set<string>()
/** Background work started and not yet heard to finish: agents, shells, monitors, workflows. */
let background = new Set<string>()
const titles = {
  isOn: false,
  failures: 0,
  applied: null as string | null,
  base: null as string | null,
  /** The whole title this add-on last wrote; kept in the status file across reloads. */
  lastWritten: null as string | null,
  /** The app's own record of this chat, read only for who named it. */
  record: null as string | null,
}
let titleQueue: Promise<void> = Promise.resolve()
let refresh: { cancel: () => void } | null = null
let pulse = false

function asLoose(value: unknown): Loose | null {
  return typeof value === 'object' && value !== null ? (value as Loose) : null
}

function helperCount(): number {
  return new Set([...loops, ...background]).size
}

function startsHelper(input: Loose): boolean {
  if (input.tool === 'Monitor' || input.tool === 'Workflow') return true

  return (input.tool === 'Bash' || input.tool === 'Agent') && input.run_in_background === true
}

// The id a background start answers with, which its finishing notice names again.
function startedId(input: Loose, result: unknown): string | null {
  const answer = asLoose(result)
  for (const key of ['backgroundTaskId', 'taskId', 'task_id', 'agentId', 'agent_id']) {
    const value = answer?.[key]
    if (typeof value === 'string' && value !== '') return value
  }

  return typeof input.tool_use_id === 'string' ? input.tool_use_id : null
}

function finishedIds(text: string): string[] {
  return [...text.matchAll(/<(?:task-id|tool-use-id)>([^<]+)<\/(?:task-id|tool-use-id)>/g)].map(match => match[1] ?? '')
}

function askingReason(input: Loose): string {
  if (input.tool === 'ExitPlanMode') return 'Plan waiting for your approval'
  const first = Array.isArray(input.questions) ? asLoose(input.questions[0]) : null

  return typeof first?.question === 'string' ? shorten(first.question, 100) : 'Question waiting for your answer'
}

function wrapUpAsk(input: Loose): string | null {
  const ask = input.ask
  if (typeof ask === 'string') return ask.trim() === '' ? null : shorten(ask, 100)

  return ask === undefined || ask === null || ask === false ? null : 'Waiting for your answer'
}

async function readAccount($: EngineInterface, home: string, sessionId: string): Promise<string | null> {
  try {
    const status = JSON.parse(await $.fs.read(`${home}/${ACCOUNT_STATUS_DIR}/${sessionId}.json`)) as { account?: unknown }

    return typeof status.account === 'string' && status.account !== 'unknown' ? status.account : null
  } catch {
    return null
  }
}

// The title this add-on last wrote for this chat, from its status file, so a reload remembers it.
async function readLastWritten($: EngineInterface, session: Live): Promise<string | null> {
  try {
    const path = `${session.home}/${STATUS_DIR}/${fileNameFor(session.sessionId, session.hostSessionId)}`
    const status = JSON.parse(await $.fs.read(path)) as { lastWrittenTitle?: unknown }

    return typeof status.lastWrittenTitle === 'string' ? status.lastWrittenTitle : null
  } catch {
    return null
  }
}

async function readStatuses($: EngineInterface, home: string): Promise<StatusFile[]> {
  const dir = `${home}/${STATUS_DIR}`
  const entries = await $.fs.list(dir).catch(() => [])
  const files = entries.filter(entry => entry.kind === 'file' && entry.name.endsWith('.json'))
  const statuses = await Promise.all(
    files.map(async entry => {
      try {
        return JSON.parse(await $.fs.read(`${dir}/${entry.name}`)) as StatusFile
      } catch {
        return null
      }
    }),
  )

  return statuses.filter((status): status is StatusFile => status !== null && status.version === 1)
}

async function readTitleSource($: EngineInterface): Promise<TitleSource> {
  if (titles.record === null) return 'unknown'
  try {
    return titleSourceOf(await $.fs.read(titles.record))
  } catch {
    // Missing, too big, or another layout: fall back to the last title this add-on wrote.
    return 'unknown'
  }
}

// Puts the marker in front of the chat's title in the desktop app's sidebar, only when it changed, and
// never in a chat the person named: the app would ask them to approve every rename.
async function syncTitle($: EngineInterface): Promise<void> {
  if (live === null || !titles.isOn) return
  const label = markerLabel(markers, live.state, progressOf(live.steps))
  if (label === titles.applied) return

  let current: string | null
  try {
    const read = await $.mcp.call(SESSIONS_SERVER, 'get_session', { session_id: 'self' })
    if (read.isError) throw new Error('get_session refused')
    current = titleFromSession(read)
  } catch {
    // No such server (a terminal), or the app is not ready: try a few times, then stay quiet.
    titles.failures += 1
    if (titles.failures >= TITLE_FAILURES_ALLOWED) titles.isOn = false
    return
  }
  titles.failures = 0
  // No title yet: leave the app to name the chat first; the next change or heartbeat tries again.
  if (current === null || stripMarker(current).trim() === '') return

  const next = withMarker(current, label)
  if (next !== current) {
    if (!mayRename(await readTitleSource($), current, titles.lastWritten)) {
      // The person's own name stays exactly as they wrote it; check again when the marker next changes.
      titles.applied = label
      titles.base = current
      return
    }
    try {
      const written = await $.mcp.call(SESSIONS_SERVER, 'set_session_title', { session_id: 'self', title: next })
      if (written.isError) throw new Error('set_session_title refused')
    } catch {
      // Refused (a Deny, say): never ask again in this chat.
      titles.isOn = false
      return
    }
    titles.lastWritten = next
  }
  titles.applied = label
  titles.base = stripMarker(current)
}

function queueTitle($: EngineInterface): Promise<void> {
  titleQueue = titleQueue.then(() => syncTitle($)).catch(() => undefined)

  return titleQueue
}

async function publish($: EngineInterface): Promise<void> {
  if (live === null) return
  try {
    const progress = progressOf(live.steps)
    const verdict = decide({ ...live.facts, helpers: helperCount(), steps: progress })
    const now = await $.clock.now()
    if (verdict.state !== live.state) {
      live.state = verdict.state
      live.stateSince = now
    }
    // The sidebar first, so the file holds the title just written. Bounded: a slow or missing title server
    // never holds up a tool call or a turn for long.
    await Promise.race([queueTitle($), $.clock.sleep(TITLE_WAIT_MS).catch(() => undefined)])
    const status: StatusFile = {
      version: 1,
      sessionId: live.sessionId,
      hostSessionId: live.hostSessionId,
      state: live.state,
      steps: { done: progress.done, total: progress.total, current: progress.current },
      helpersRunning: helperCount(),
      waitingReason: verdict.waitingReason,
      title: titles.base,
      lastWrittenTitle: titles.lastWritten,
      cwd: live.cwd,
      project: projectOf(live.cwd),
      account: await readAccount($, live.home, live.sessionId),
      stateSince: live.stateSince,
      updatedAt: now,
      ended: live.ended,
    }
    await $.fs.write(
      `${live.home}/${STATUS_DIR}/${fileNameFor(live.sessionId, live.hostSessionId)}`,
      `${JSON.stringify(status, null, 2)}\n`,
    )
  } catch {
    // Reporting must never get in the way of the session's own work.
  }
}

function changeFacts($: EngineInterface, change: (facts: Live['facts']) => Partial<Live['facts']>): Promise<void> {
  if (live === null) return Promise.resolve()
  live.facts = { ...live.facts, ...change(live.facts) }

  return publish($)
}

async function openSession($: EngineInterface, row: BoardRow): Promise<void> {
  const argv = openArgv(row.hostSessionId)
  if (argv === null) return
  try {
    await $.process.run(argv)
  } catch {
    // `open` is macOS's; elsewhere the row just does nothing.
  }
}

export const register: Register = (on, options) => {
  markers = markerSetOf(options.markers)

  on('session.start', async ($, e, next) => {
    const answer = await next(e)
    try {
      const [home, hostSessionId, execPath, accountId, organizationId, sessionId, now] = await Promise.all([
        $.env.get('HOME'),
        $.env.get('CLAUDE_CODE_HOST_SESSION_ID'),
        $.env.get('CLAUDE_CODE_EXECPATH'),
        $.env.get('CLAUDE_CODE_ACCOUNT_UUID'),
        $.env.get('CLAUDE_CODE_ORGANIZATION_UUID'),
        $.session.id(),
        $.clock.now(),
      ])
      live = {
        home: home ?? '',
        cwd: e.cwd,
        sessionId,
        hostSessionId: hostSessionId || null,
        facts: { turnRunning: false, lastEnd: null, asking: null, wrapAsk: null, wrappedUp: false },
        steps: [],
        state: 'idle',
        stateSince: now,
        ended: false,
      }
      // Only a chat the desktop app hosts has a sidebar title to mark.
      titles.isOn = live.hostSessionId !== null
      titles.record = recordPath({ execPath, accountId, organizationId, hostSessionId })
      titles.lastWritten = await readLastWritten($, live)
      await $.command.register({
        name: 'sessions',
        description: 'Show every session: which are working, which need you, which are done',
      })
      $.clock.every(HEARTBEAT_MS, () => void publish($))
      await publish($)
    } catch {
      live = null
    }

    return answer
  })

  on('turn.start', async ($, e, next) => {
    const answer = await next(e)
    if (e.agentId !== undefined) {
      loops.add(e.agentId)
      await publish($)
    } else {
      await changeFacts($, () => ({ turnRunning: true, lastEnd: null, asking: null, wrapAsk: null, wrappedUp: false }))
    }

    return answer
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const answer = await next(e)
    if (e.agentId !== undefined) {
      loops.delete(e.agentId)
      background.delete(e.agentId)
      await publish($)
    } else {
      await changeFacts($, () => ({ turnRunning: false, lastEnd: e.reason, asking: null }))
    }

    return answer
  }).catch(($, e, next) => next(e))

  // At each stop the engine lists the background work still in flight. It only takes away what we saw start
  // and is no longer listed (a finish notice we missed); it never adds: the list also holds watchers the app
  // arms itself that never end by design (an artifact page's comment watcher), which would keep it working.
  on('classic.Stop', async ($, e, next) => {
    if (Array.isArray(e.background_tasks)) {
      const inFlight = new Set(e.background_tasks.map(task => task.id))
      background = new Set([...background].filter(id => inFlight.has(id)))
      await publish($)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    if (e.origin?.kind === 'task-notification') {
      for (const id of finishedIds(e.text)) background.delete(id)
      await publish($)
    } else if (live !== null && e.isMeta !== true && progressOf(live.steps).isComplete) {
      // A new request after a finished plan starts with no steps, as task-progress puts its bar away.
      live.steps = []
      await publish($)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // Each hook only watches: it lets the tool run, then copies what changed.
  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Loose
    const isMain = e.agentId === undefined
    const waits = isMain && (input.tool === 'AskUserQuestion' || input.tool === 'ExitPlanMode')

    if (waits) await changeFacts($, () => ({ asking: askingReason(input) }))
    const answer = await next(e)
    if (waits) await changeFacts($, () => ({ asking: null }))

    if (live === null || answer.deny !== undefined || answer.isError) return answer

    let changed = false
    if (isMain) {
      const steps = stepsAfterCall(live.steps, input, answer.result)
      if (steps !== null) {
        live.steps = steps
        changed = true
      }
      if (input.tool === WRAP_UP) {
        const ask = wrapUpAsk(input)
        live.facts = { ...live.facts, wrapAsk: ask, wrappedUp: ask === null }
        changed = true
      }
      changed ||= input.tool === UPDATE_PLAN
    }
    if (startsHelper(input)) {
      const id = startedId(input, answer.result)
      if (id !== null) background.add(id)
      changed = true
    }
    if (input.tool === 'TaskStop') {
      for (const id of [input.task_id, input.shell_id]) if (typeof id === 'string') background.delete(id)
      changed = true
    }
    if (changed) await publish($)

    return answer
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (live !== null) {
      // The process ends, and with it every helper it ran.
      loops.clear()
      background.clear()
      live.ended = true
      live.facts = { ...live.facts, turnRunning: false, asking: null }
      await publish($)
    }

    return next(e)
  })

  on('command.run', { command: 'sessions' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Sessions' })
    refresh ??= $.clock.every(BOARD_REFRESH_MS, () => {
      pulse = !pulse
      $.ui.invalidate('ui.render')
    })

    return { text: 'Opened the sessions board.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      refresh?.cancel()
      refresh = null
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    // Only the desktop draws SVG: its dots pulse and its bars are rounded; the terminal draws characters.
    const Svg = e.surface === 'desktop' ? $.ui.resolve(e).Svg : null
    const isDesktop = Svg !== null
    const palette = COLORS[isDesktop ? 'desktop' : 'terminal']
    const home = live?.home ?? (await $.env.get('HOME')) ?? ''
    const [statuses, now] = await Promise.all([readStatuses($, home), $.clock.now()])
    const rows = boardRows(statuses, now)
    const shown = rows.filter(row => row.shownState !== 'idle')
    const idle = rows.length - shown.length

    if (rows.length === 0) {
      return <Text dimColor>No sessions yet. Each chat shows here once it starts.</Text>
    }

    const counts = (['needs-you', 'working', 'done', 'failed'] as const)
      .map(state => ({ state, count: shown.filter(row => row.shownState === state).length }))
      .filter(part => part.count > 0)

    return (
      <Box flexDirection="column" gap={isDesktop ? 1 : 0}>
        <Text>
          {counts.map((part, index) => (
            <Text color={palette[part.state]} bold>
              {index > 0 ? ' · ' : ''}
              {part.count} {LABELS[part.state].toLowerCase()}
            </Text>
          ))}
          {idle > 0 ? <Text dimColor>{counts.length > 0 ? ' · ' : ''}{idle} idle</Text> : null}
        </Text>
        {shown.map(row => {
          const color = palette[row.shownState]
          const title = row.title ?? 'Untitled session'
          const opens = openArgv(row.hostSessionId) !== null
          const key = `row-${row.hostSessionId ?? row.sessionId}`

          return (
            <Box
              key={key}
              flexDirection="row"
              alignItems="center"
              gap={1}
              paddingX={isDesktop ? 1 : 0}
              backgroundColor={isDesktop && row.shownState === 'needs-you' ? NEEDS_YOU_ROW : undefined}
            >
              <Box width={12} flexDirection="row" alignItems="center" gap={1}>
                {Svg !== null ? (
                  <Svg
                    source={svgDot(color, row.shownState === 'working')}
                    alt={LABELS[row.shownState]}
                    width={10}
                    height={10}
                    isInteractive={row.shownState === 'working' ? true : undefined}
                  />
                ) : (
                  <Text color={color}>{row.shownState === 'needs-you' ? '▌' : row.shownState === 'working' && pulse ? '◉' : '●'}</Text>
                )}
                <Text color={color} bold>
                  {LABELS[row.shownState]}
                </Text>
              </Box>
              <Box flexGrow={2} flexShrink={1} flexDirection="column">
                {opens ? (
                  <Button key={`open-${row.hostSessionId}`} plain label={title} onPress={() => openSession($, row)} />
                ) : (
                  <Text wrap="truncate-end">{title}</Text>
                )}
                <Text dimColor wrap="truncate-end">
                  {row.project}
                </Text>
              </Box>
              <Box width={16} flexDirection="row" alignItems="center" gap={1}>
                {row.steps.total === 0 ? (
                  <Text dimColor>no steps</Text>
                ) : Svg !== null ? (
                  <Svg source={svgBar(row.steps.done, row.steps.total, color, 60, 6)} alt={`${row.steps.done} of ${row.steps.total} steps`} width={60} height={6} />
                ) : (
                  <Text color={color}>{textBar(row.steps.done, row.steps.total, 8)}</Text>
                )}
                {row.steps.total === 0 ? null : <Text>{`${row.steps.done}/${row.steps.total}`}</Text>}
              </Box>
              <Box flexGrow={3} flexShrink={1}>
                <Text dimColor wrap="truncate-end">
                  {detailOf(row)}
                </Text>
              </Box>
              <Box width={10}>
                <Text dimColor wrap="truncate-end">
                  {row.account ?? ''}
                </Text>
              </Box>
              <Box width={5}>
                <Text dimColor>{durationText(now - row.stateSince)}</Text>
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
