import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { StatusFile } from '../hooks/status'

const HOME = '/home/demo'
const NOW = Date.parse('2026-10-29T10:00:00Z')
const HOST_ID = 'local_0b8a41f2-demo'
const FILE = `${HOME}/.claude-session-status/${HOST_ID}.json`

type World = {
  files: Map<string, string>
  title: string
  /** Every title set_session_title was asked for, in order. */
  renames: string[]
  mcpCalls: number
  opened: string[][]
  /** The state written while AskUserQuestion was open. */
  stateWhileAsking: string | null
  /** The session server refuses every call. */
  refuses: boolean
}

function world(over: Partial<World> = {}): World {
  return { files: new Map(), title: 'Fix the login page', renames: [], mcpCalls: 0, opened: [], stateWhileAsking: null, refuses: false, ...over }
}

function status(w: World): StatusFile | undefined {
  const text = w.files.get(FILE)

  return text === undefined ? undefined : (JSON.parse(text) as StatusFile)
}

// Stands in for Claude Code and the desktop app beneath the mod: files, the session, the tools, the
// app's session server. Nothing runs for real.
function engine(on: On, w: World, env: Record<string, string> = { HOME, CLAUDE_CODE_HOST_SESSION_ID: HOST_ID }) {
  mock.env(on, env)
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => ({ value: 's-cli' }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('classic.Stop', () => ({}))
  on('fs.read', ($, e) => {
    const text = w.files.get(e.path)

    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('fs.write', ($, e) => {
    w.files.set(e.path, e.text)

    return { value: undefined }
  })
  on('fs.list', ($, e) => ({
    value: [...w.files.keys()]
      .filter(path => path.startsWith(`${e.path}/`))
      .map(path => ({ name: path.split('/').pop() ?? path, kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false })),
  }))
  on('mcp.call', ($, e) => {
    w.mcpCalls += 1
    if (w.refuses || e.server !== 'ccd_session_mgmt') return { deny: 'no such server' }
    if (e.tool === 'get_session') {
      return { value: { content: [{ type: 'text', text: JSON.stringify({ id: HOST_ID, title: w.title }) }], isError: false } }
    }
    w.title = String(e.args.title)
    w.renames.push(w.title)

    return { value: { content: [{ type: 'text', text: 'ok' }], isError: false } }
  })
  on('process.run', ($, e) => {
    w.opened.push([...e.argv])

    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', ($, e) => {
    switch (e.tool) {
      case 'TaskCreate':
        return { result: { task: { id: String(e.subject).slice(0, 1), subject: e.subject } } }
      case 'TaskUpdate':
        return { result: { success: true, taskId: e.taskId, updatedFields: ['status'] } }
      case 'Bash':
        return { result: { stdout: '', stderr: '', backgroundTaskId: String(e.description) } }
      case 'Agent':
        return { result: { status: 'async_launched', agentId: String(e.description) } }
      case 'TodoWrite':
        return { result: { oldTodos: [], newTodos: e.todos } }
      case 'AskUserQuestion':
        w.stateWhileAsking = status(w)?.state ?? null
        return { result: { answers: {} } }
      default:
        return { result: 'ok' }
    }
  })
}

let turns = 0

async function startTurn($: Engine, agentId?: string) {
  turns += 1
  await $.turn.start({ text: '', turnId: `t${turns}`, ...(agentId ? { agentId } : {}) })
}

async function endTurn(
  $: Engine,
  reason: 'answer' | 'aborted' | 'error' = 'answer',
  agentId?: string,
) {
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId: `t${turns}`, reason, ...(agentId ? { agentId } : {}) })
}

async function begin($: Engine) {
  await $.session.start({ cwd: `${HOME}/code/shop`, surface: 'desktop', isInteractive: true })
}

const PLAN = [
  { content: 'Read the code', status: 'in_progress' },
  { content: 'Fix the bug', status: 'pending' },
  { content: 'Run tests', status: 'pending' },
]

describe('the status file', () => {
  test('starts idle, works through a turn, and is done when it ends', async ($, on) => {
    const w = world()
    engine(on, w)
    await begin($)
    expect(status(w)).toMatchObject({ state: 'idle', hostSessionId: HOST_ID, sessionId: 's-cli', project: 'shop', account: null })

    await startTurn($)
    expect(status(w)?.state).toBe('working')

    await endTurn($)
    expect(status(w)?.state).toBe('done')
  })

  test('an error ends it failed; a stop by the person leaves it idle', async ($, on) => {
    const w = world()
    engine(on, w)
    await begin($)
    await startTurn($)
    await endTurn($, 'error')
    expect(status(w)).toMatchObject({ state: 'failed', waitingReason: 'Ended with an error' })

    await startTurn($)
    await endTurn($, 'aborted')
    expect(status(w)?.state).toBe('idle')
  })

  test('counts the desktop plan, and a turn that stops with steps left needs you', async ($, on) => {
    const w = world()
    engine(on, w)
    await begin($)
    await startTurn($)
    await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: PLAN, scope: 'turn' })
    await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true })
    expect(status(w)?.steps).toEqual({ done: 1, total: 3, current: 'Fix the bug' })

    await endTurn($)
    expect(status(w)).toMatchObject({ state: 'needs-you', waitingReason: 'Stopped with 2 of 3 steps left' })
  })

  test('wrap_up with no ask is done; with an ask it needs you', async ($, on) => {
    const w = world()
    engine(on, w)
    await begin($)
    await startTurn($)
    await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: PLAN })
    await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up' })
    await endTurn($)
    expect(status(w)).toMatchObject({ state: 'done', steps: { done: 3, total: 3 } })

    await startTurn($)
    await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up', ask: 'Shall I open the PR?' })
    await endTurn($)
    expect(status(w)).toMatchObject({ state: 'needs-you', waitingReason: 'Shall I open the PR?' })
  })

  test('reads TodoWrite and the Task tools too', async ($, on) => {
    const w = world()
    engine(on, w)
    await begin($)
    await startTurn($)
    await $.tool.call({ tool: 'TaskCreate', subject: 'One', description: 'd' })
    await $.tool.call({ tool: 'TaskCreate', subject: 'Two', description: 'd', activeForm: 'Doing two' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: 'O', status: 'completed' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: 'T', status: 'in_progress' })
    expect(status(w)?.steps).toEqual({ done: 1, total: 2, current: 'Doing two' })

    await $.tool.call({
      tool: 'TodoWrite',
      todos: [
        { content: 'A', status: 'completed', activeForm: 'Doing A' },
        { content: 'B', status: 'completed', activeForm: 'Doing B' },
      ],
    })
    await endTurn($)
    expect(status(w)).toMatchObject({ state: 'done', steps: { done: 2, total: 2 } })
  })

  test('a new request after a finished plan starts with no steps', async ($, on) => {
    const w = world()
    engine(on, w)
    await begin($)
    await startTurn($)
    await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: PLAN })
    await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up' })
    await endTurn($)
    await $.prompt.submit({ text: 'Now the docs', wait: false, origin: { kind: 'composer' } })
    await startTurn($)
    expect(status(w)).toMatchObject({ state: 'working', steps: { done: 0, total: 0 } })
    expect(w.title).toBe('⏳ Fix the login page')
  })

  test('an open question needs you while it waits', async ($, on) => {
    const w = world()
    engine(on, w)
    await begin($)
    await startTurn($)
    await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Which branch?', header: 'Branch', options: [], multiSelect: false }] })
    expect(w.stateWhileAsking).toBe('needs-you')
    expect(status(w)?.state).toBe('working')
  })

  test('helpers keep it working after the turn ends, and a woken turn does not end it early', async ($, on) => {
    const w = world()
    engine(on, w)
    await begin($)
    await startTurn($)
    await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'tests', run_in_background: true })
    // Older builds take run_in_background on Agent; newer ones have none, and the agent counts by its own loop.
    const reviewer = { tool: 'Agent' as const, description: 'reviewer', prompt: 'p', subagent_type: 'general-purpose', run_in_background: true }
    await $.tool.call(reviewer)
    await startTurn($, 'reviewer')
    await endTurn($)
    expect(status(w)).toMatchObject({ state: 'working', helpersRunning: 2 })

    // The shell finishes and wakes the main loop; the reviewer is still out.
    await $.prompt.submit({
      text: '<task-notification><task-id>tests</task-id><status>completed</status></task-notification>',
      wait: false,
      origin: { kind: 'task-notification' },
    })
    await startTurn($)
    await endTurn($)
    expect(status(w)).toMatchObject({ state: 'working', helpersRunning: 1 })

    // The reviewer's own turn ends; its notice wakes the main loop once more.
    await endTurn($, 'error', 'reviewer')
    expect(status(w)?.state).toBe('done')
  })

  test("the engine's list of work in flight at a stop corrects the count", async ($, on) => {
    const w = world()
    engine(on, w)
    await begin($)
    await startTurn($)
    await $.tool.call({ tool: 'Bash', command: 'sleep 99', description: 'long', run_in_background: true })
    await endTurn($)
    expect(status(w)?.state).toBe('working')

    await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
    expect(status(w)).toMatchObject({ state: 'done', helpersRunning: 0 })
  })

  test('a watcher the app armed itself, listed at a stop, never keeps it working', async ($, on) => {
    const w = world()
    engine(on, w)
    await begin($)
    await startTurn($)
    await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: PLAN })
    await endTurn($)
    await $.classic.Stop({
      stop_hook_active: false,
      background_tasks: [
        { id: 'x', type: 'monitor', status: 'running', description: 'Watch for page comments' },
        { id: 'y', type: 'artifact-comment-monitor', status: 'running', description: 'Artifact comments' },
      ],
    })
    expect(status(w)?.helpersRunning).toBe(0)
    expect(status(w)?.state).not.toBe('working')

    await startTurn($)
    await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up' })
    await endTurn($)
    await $.classic.Stop({
      stop_hook_active: false,
      background_tasks: [{ id: 'y', type: 'artifact-comment-monitor', status: 'running', description: 'Artifact comments' }],
    })
    expect(status(w)).toMatchObject({ state: 'done', helpersRunning: 0 })
  })

  test('a shell it saw start, still listed at a stop, keeps it working', async ($, on) => {
    const w = world()
    engine(on, w)
    await begin($)
    await startTurn($)
    await $.tool.call({ tool: 'Bash', command: 'npm run build', description: 'build', run_in_background: true })
    await endTurn($)
    await $.classic.Stop({
      stop_hook_active: false,
      background_tasks: [
        { id: 'build', type: 'shell', status: 'running', description: 'build', command: 'npm run build' },
        { id: 'y', type: 'artifact-comment-monitor', status: 'running', description: 'Artifact comments' },
      ],
    })
    expect(status(w)).toMatchObject({ state: 'working', helpersRunning: 1 })
  })

  test('a shell it saw start, missing from the list at a stop, is taken away', async ($, on) => {
    const w = world()
    engine(on, w)
    await begin($)
    await startTurn($)
    await $.tool.call({ tool: 'Bash', command: 'npm run build', description: 'build', run_in_background: true })
    await $.tool.call({ tool: 'Bash', command: 'npm run lint', description: 'lint', run_in_background: true })
    await endTurn($)
    expect(status(w)?.helpersRunning).toBe(2)

    await $.classic.Stop({
      stop_hook_active: false,
      background_tasks: [{ id: 'lint', type: 'shell', status: 'running', description: 'lint', command: 'npm run lint' }],
    })
    expect(status(w)).toMatchObject({ state: 'working', helpersRunning: 1 })
  })

  test("picks up the multi-account tag for the same session", async ($, on) => {
    const w = world()
    w.files.set(`${HOME}/.claude-accounts/status/s-cli.json`, JSON.stringify({ version: 1, account: 'claude-b' }))
    engine(on, w)
    await begin($)
    expect(status(w)?.account).toBe('claude-b')
  })
})

describe('the sidebar title', () => {
  test('marks the title, renames only when the mark changes, and keeps the title', async ($, on) => {
    const w = world()
    engine(on, w)
    await begin($)
    await startTurn($)
    await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: PLAN })
    await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: PLAN })
    await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true })
    await endTurn($)
    await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up' })
    await startTurn($)
    await endTurn($)

    expect(w.renames).toEqual([
      '⏳ Fix the login page',
      '⏳ 0/3 Fix the login page',
      '⏳ 1/3 Fix the login page',
      '💬 1/3 Fix the login page',
      '✅ Fix the login page',
      '⏳ 3/3 Fix the login page',
      '✅ Fix the login page',
    ])
    expect(status(w)?.title).toBe('Fix the login page')
  })

  test('keeps a title the person changed in the sidebar', async ($, on) => {
    const w = world()
    engine(on, w)
    await begin($)
    await startTurn($)
    w.title = 'Login fix, take two'
    await endTurn($)
    expect(w.title).toBe('✅ Login fix, take two')
  })

  test('waits for the app to name a new chat', async ($, on) => {
    const w = world({ title: '' })
    engine(on, w)
    await begin($)
    await startTurn($)
    expect(w.renames).toEqual([])
    w.title = 'Named by the app'
    await endTurn($)
    expect(w.renames).toEqual(['✅ Named by the app'])
  })

  test('uses the marker set picked in the options', { options: { markers: 'C' } }, async ($, on) => {
    const w = world({ title: '⏳ 2/5 Old marks' })
    engine(on, w)
    await begin($)
    await startTurn($)
    expect(w.title).toBe('🔵 Old marks')
  })

  test('with markers off it only takes an old one away', { options: { markers: 'off' } }, async ($, on) => {
    const w = world({ title: '✅ Fix the login page' })
    engine(on, w)
    await begin($)
    await startTurn($)
    await endTurn($)
    expect(w.renames).toEqual(['Fix the login page'])
  })

  test('outside the desktop app it never calls the session server', async ($, on) => {
    const w = world()
    engine(on, w, { HOME })
    await begin($)
    await startTurn($)
    await endTurn($)
    expect(w.mcpCalls).toBe(0)
    expect(w.files.has(`${HOME}/.claude-session-status/s-cli.json`)).toBe(true)
  })

  test('gives up quietly when the server refuses', async ($, on) => {
    const w = world({ refuses: true })
    engine(on, w)
    await begin($)
    for (let i = 0; i < 5; i += 1) {
      await startTurn($)
      await endTurn($, i % 2 === 0 ? 'answer' : 'error')
    }
    expect(w.mcpCalls).toBe(3)
    // The status file still follows the session.
    expect(status(w)?.state).toBe('done')
  })
})

const PANE = {
  plugin: 'session-status',
  component: 'Pane',
  requestId: 'sessions',
  props: {
    title: 'Sessions',
    isFocused: false,
    bodyColumns: 120,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

function boardFile(over: Partial<StatusFile>): string {
  const base: StatusFile = {
    version: 1,
    sessionId: 'x',
    hostSessionId: null,
    state: 'idle',
    steps: { done: 0, total: 0, current: null },
    helpersRunning: 0,
    waitingReason: null,
    title: null,
    cwd: `${HOME}/code/shop`,
    project: 'shop',
    account: null,
    stateSince: NOW - 4 * 60_000,
    updatedAt: NOW,
    ended: false,
  }

  return JSON.stringify({ ...base, ...over })
}

describe('the /sessions board', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`lists every session by what it needs, and a row opens its chat (${surface})`, async ($, on) => {
      const w = world()
      const dir = `${HOME}/.claude-session-status`
      w.files.set(`${dir}/a.json`, boardFile({ sessionId: 'a', hostSessionId: 'local_a', state: 'done', title: 'Write the docs' }))
      w.files.set(
        `${dir}/b.json`,
        boardFile({
          sessionId: 'b',
          hostSessionId: 'local_b',
          state: 'needs-you',
          title: 'Deploy the shop',
          waitingReason: 'Which region?',
          account: 'claude-b',
          steps: { done: 2, total: 5, current: null },
        }),
      )
      w.files.set(
        `${dir}/c.json`,
        boardFile({ sessionId: 'c', state: 'working', title: 'Run the tests', steps: { done: 4, total: 7, current: 'Running tests' }, helpersRunning: 1 }),
      )
      w.files.set(`${dir}/d.json`, boardFile({ sessionId: 'd', state: 'idle' }))
      engine(on, w, { HOME })
      await begin($)
      await $.command.run({
        command: 'sessions',
        args: '',
        origin: { kind: 'composer' },
        presentation: { isFullscreen: false, columns: 120 },
      })

      const ui = await $.ui.mount({ ...PANE, surface })

      expect(await ui.find({ type: 'Text', text: '1 needs you' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Which region?' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'claude-b' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '2/5' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Running tests · 1 helper running' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '4m' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: /idle/ })).toBeDefined()

      await ui.press({ key: 'open-local_b' })
      expect(w.opened).toEqual([['open', 'claude://claude.ai/epitaxy/local_b']])
      await ui.unmount()
    })
  }
})
