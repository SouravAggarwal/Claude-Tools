import type { EngineInterface, Register } from 'claude-code'

import {
  CONFIG_FILE,
  STATUS_DIR,
  accountFor,
  agoText,
  bar,
  isShown,
  latestLimits,
  projectFor,
  roleOf,
  shorten,
  toolActivity,
  untilText,
} from './status'
import type { Config, SessionStatus } from './status'

const PANE = 'accounts'
const HEARTBEAT_MS = 20_000
const PANE_REFRESH_MS = 5_000

type Live = {
  home: string
  account: string
  project: string | null
  cwd: string
  startedAt: number
  state: SessionStatus['state']
  task: string | null
  lastPrompt: string | null
  activity: string | null
}

async function readConfig($: EngineInterface, home: string): Promise<Config | null> {
  try {
    return JSON.parse(await $.fs.read(`${home}/${CONFIG_FILE}`)) as Config
  } catch {
    return null
  }
}

async function readStatuses($: EngineInterface, home: string): Promise<SessionStatus[]> {
  const dir = `${home}/${STATUS_DIR}`
  const entries = await $.fs.list(dir).catch(() => [])
  const files = entries.filter(entry => entry.kind === 'file' && entry.name.endsWith('.json'))
  const statuses = await Promise.all(
    files.map(async entry => {
      try {
        return JSON.parse(await $.fs.read(`${dir}/${entry.name}`)) as SessionStatus
      } catch {
        return null
      }
    }),
  )

  return statuses.filter((status): status is SessionStatus => status !== null && status.version === 1)
}

// Module state: a reload starts it over, and the next heartbeat writes a fresh status.
let live: Live | null = null
const taskNames = new Map<string, string>()
let refresh: { cancel: () => void } | null = null

async function publish($: EngineInterface) {
  if (live === null) return
  try {
    const [sessionId, usage, model, surface, entrypoint, now] = await Promise.all([
      $.session.id(),
      $.session.usage(),
      $.session.model(),
      $.session.surface(),
      $.env.get('CLAUDE_CODE_ENTRYPOINT'),
      $.clock.now(),
    ])
    // Background (-p) chats keep no live context figure; claude-ask fills it in from the run's own usage.
    const context = { percent: usage.context.percent ?? null, tokens: usage.context.tokens ?? null, window: usage.context.window }
    const status: SessionStatus = {
      version: 1,
      account: live.account,
      sessionId,
      cwd: live.cwd,
      project: live.project,
      model,
      // The desktop app runs its chats headless, so its surface can read as none: its entrypoint says it.
      kind:
        surface === 'terminal' ? 'terminal' : surface === 'desktop' || entrypoint === 'claude-desktop' ? 'desktop' : 'background',
      state: live.state,
      task: live.task,
      lastPrompt: live.lastPrompt,
      activity: live.activity,
      context,
      rateLimits: usage.rateLimits.map(limit => ({
        kind: limit.kind,
        percentUsed: limit.percentUsed,
        resetsAt: limit.resetsAt ?? null,
      })),
      costUsd: usage.cost?.usd ?? null,
      startedAt: live.startedAt,
      updatedAt: now,
    }
    await $.fs.write(`${live.home}/${STATUS_DIR}/${sessionId}.json`, `${JSON.stringify(status, null, 2)}\n`)
  } catch {
    // Reporting must never get in the way of the session's own work.
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const answer = await next(e)
    try {
      const home = (await $.env.get('HOME')) ?? ''
      const configDir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${home}/.claude`
      const config = await readConfig($, home)
      live = {
        home,
        account: accountFor(config, configDir, home),
        project: projectFor(config, e.cwd, home),
        cwd: e.cwd,
        startedAt: (await $.session.usage()).startedAt,
        state: 'idle',
        task: null,
        lastPrompt: null,
        activity: null,
      }
      await $.command.register({
        name: 'accounts',
        description: 'Show every Claude account: 5-hour and weekly limits, context and what each session is doing',
      })
      $.clock.every(HEARTBEAT_MS, () => void publish($))
      await publish($)
    } catch {
      live = null
    }

    return answer
  })

  on('prompt.submit', async ($, e, next) => {
    if (live !== null && e.isMeta !== true) {
      live.state = 'working'
      live.activity = null
      live.lastPrompt = e.command ? shorten(`/${e.command.name} ${e.command.args}`, 100) : shorten(e.text, 100)
      await publish($)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    if (live !== null && e.agentId === undefined) {
      live.activity = toolActivity(String(e.tool), e)
      await publish($)
    }
    const answer = await next(e)

    if (live !== null && answer.deny === undefined && !answer.isError) {
      if (e.tool === 'TaskCreate' && answer.result !== undefined) {
        const id = (answer.result as { task?: { id?: string } }).task?.id
        if (id) taskNames.set(id, e.activeForm ?? e.subject)
      }
      if (e.tool === 'TaskUpdate') {
        const label = e.activeForm ?? e.subject
        if (label) taskNames.set(e.taskId, label)
        const name = label ?? taskNames.get(e.taskId) ?? null
        if (e.status === 'in_progress') live.task = name
        if ((e.status === 'completed' || e.status === 'deleted') && live.task === name) live.task = null
      }
      if (e.tool === 'TodoWrite' && e.agentId === undefined) {
        const running = e.todos.find(todo => todo.status === 'in_progress')
        live.task = running ? running.activeForm || running.content : null
      }
      if (e.tool === 'TaskCreate' || e.tool === 'TaskUpdate' || e.tool === 'TodoWrite') {
        await publish($)
      }
    }

    return answer
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const answer = await next(e)
    if (live !== null && e.agentId === undefined) {
      live.state = 'idle'
      live.activity = null
      await publish($)
    }

    return answer
  })

  on('session.end', async ($, e, next) => {
    if (live !== null) {
      live.state = 'ended'
      live.activity = null
      await publish($)
    }

    return next(e)
  })

  on('command.run', { command: 'accounts' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Claude accounts' })
    refresh ??= $.clock.every(PANE_REFRESH_MS, () => $.ui.invalidate('ui.render'))

    return { text: 'Opened the Claude accounts pane.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      refresh?.cancel()
      refresh = null
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const home = live?.home ?? (await $.env.get('HOME')) ?? ''
    const [config, statuses, now] = await Promise.all([readConfig($, home), readStatuses($, home), $.clock.now()])
    const accounts = Object.entries(config?.accounts ?? {})

    if (accounts.length === 0) {
      return <Text dimColor>No accounts set up yet. Add them to ~/{CONFIG_FILE}.</Text>
    }

    return (
      <Box flexDirection="column" gap={1}>
        {accounts.map(([tag, account]) => {
          const reading = latestLimits(statuses, tag)
          const sessions = statuses
            .filter(status => status.account === tag && isShown(status, now))
            .sort((a, b) => b.updatedAt - a.updatedAt)

          return (
            <Box key={tag} flexDirection="column">
              <Text>
                <Text bold color="claude">
                  {tag}
                </Text>
                <Text dimColor>
                  {' '}
                  {account.label ?? ''} · {config === null ? '' : roleOf(config, tag)}
                </Text>
              </Text>
              {reading === null ? (
                <Text dimColor>  limits: no reading yet (shows after this account's next message)</Text>
              ) : (
                reading.limits.map(limit => (
                  <Text>
                    {'  '}
                    {limit.kind === 'five_hour' ? '5 hours' : limit.kind === 'seven_day' ? 'week   ' : limit.kind}{' '}
                    <Text color={limit.percentUsed >= 80 ? 'error' : limit.percentUsed >= 50 ? 'warning' : 'success'}>
                      {bar(limit.percentUsed, 20)}
                    </Text>{' '}
                    {Math.round(limit.percentUsed)}% <Text dimColor>{untilText(limit.resetsAt, now)}</Text>
                  </Text>
                ))
              )}
              {reading === null ? null : <Text dimColor>  as of {agoText(reading.at, now)}</Text>}
              {sessions.length === 0 ? (
                <Text dimColor>  no session running</Text>
              ) : (
                sessions.map(status => (
                  <Box flexDirection="column">
                    <Text>
                      {'  '}
                      <Text color={status.state === 'working' ? 'success' : 'inactive'}>
                        {status.state === 'working' ? '●' : '○'}
                      </Text>{' '}
                      {status.project ?? 'other'} · {status.cwd.split('/').pop()} · {status.kind} ·{' '}
                      {status.state === 'ended' ? `ended ${agoText(status.updatedAt, now)}` : status.state} · context{' '}
                      {status.context.percent === null ? 'n/a' : `${status.context.percent}%`}
                    </Text>
                    <Text dimColor wrap="truncate-end">
                      {'      '}
                      {status.task ?? status.lastPrompt ?? 'waiting for a prompt'}
                      {status.activity ? `  (${status.activity})` : ''}
                    </Text>
                  </Box>
                ))
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
