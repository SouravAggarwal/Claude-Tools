import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { accountFor, isShown, latestLimits, projectFor, toolActivity, untilText } from '../hooks/status'
import type { Config, SessionStatus } from '../hooks/status'

const HOME = '/home/demo'
const CONFIG: Config = {
  active: 'claude-b',
  accounts: {
    'claude-a': {
      label: 'a@example.com',
      configDir: '~/.claude-accounts/homes/claude-a',
      desktopConfigDir: '~/.claude',
      desktopApp: true,
      worker: true,
    },
    'claude-b': { label: 'b@example.com', configDir: '~/.claude-accounts/homes/claude-b' },
  },
  projects: {
    shop: { folders: ['~/code/shop'] },
    'web-app': { folders: ['~/code/web-app'] },
  },
}

const NOW = Date.parse('2026-10-21T10:00:00Z')

function status(over: Partial<SessionStatus>): SessionStatus {
  return {
    version: 1,
    account: 'claude-b',
    sessionId: 's1',
    cwd: `${HOME}/code/web-app`,
    project: 'web-app',
    model: 'claude-opus-5-5',
    kind: 'background',
    state: 'idle',
    task: null,
    lastPrompt: null,
    activity: null,
    context: { percent: 12, tokens: 24000, window: 200000 },
    rateLimits: [],
    costUsd: null,
    startedAt: NOW - 60_000,
    updatedAt: NOW,
    ...over,
  }
}

describe('matching folders and accounts', () => {
  test('finds the account by its Claude folder', () => {
    expect(accountFor(CONFIG, `${HOME}/.claude-accounts/homes/claude-b/`, HOME)).toBe('claude-b')
    expect(accountFor(CONFIG, `${HOME}/.claude`, HOME)).toBe('claude-a')
    expect(accountFor(CONFIG, `${HOME}/.claude-accounts/homes/claude-a`, HOME)).toBe('claude-a')
    expect(accountFor(CONFIG, '/elsewhere', HOME)).toBe('unknown')
  })

  test('finds the project by folder, inside subfolders too, never by a look-alike name', () => {
    expect(projectFor(CONFIG, `${HOME}/code/shop/packages/cart`, HOME)).toBe('shop')
    expect(projectFor(CONFIG, `${HOME}/code/web-app/server`, HOME)).toBe('web-app')
    expect(projectFor(CONFIG, `${HOME}/code/web-app-archive`, HOME)).toBeNull()
  })

  test('names the tool and what it touches', () => {
    expect(toolActivity('Bash', { command: 'npm test', description: 'Run tests' })).toBe('Bash: Run tests')
    expect(toolActivity('Edit', { file_path: '/a/b/page.svelte' })).toBe('Edit: page.svelte')
    expect(toolActivity('WebSearch', { query: 'x' })).toBe('WebSearch')
  })
})

describe('reading statuses back', () => {
  test('hides a session whose heartbeat stopped, keeps a just-ended one a while', () => {
    expect(isShown(status({ updatedAt: NOW - 60_000 }), NOW)).toBe(true)
    expect(isShown(status({ updatedAt: NOW - 10 * 60_000 }), NOW)).toBe(false)
    expect(isShown(status({ state: 'ended', updatedAt: NOW - 10 * 60_000 }), NOW)).toBe(true)
  })

  test('takes the freshest limits of an account', () => {
    const older = status({ updatedAt: NOW - 5000, rateLimits: [{ kind: 'five_hour', percentUsed: 10, resetsAt: null }] })
    const newer = status({ sessionId: 's2', rateLimits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: null }] })
    expect(latestLimits([older, newer], 'claude-b')?.limits[0]?.percentUsed).toBe(30)
    expect(latestLimits([older, newer], 'claude-a')).toBeNull()
  })

  test('says when a window resets', () => {
    expect(untilText('2026-10-21T12:30:00Z', NOW)).toBe('resets in 2h 30m')
    expect(untilText('2026-10-24T13:00:00Z', NOW)).toBe('resets in 3d 3h')
  })
})

// Stands in for Claude Code beneath the mod: its files, session facts and timers.
function engine(on: On, writes: Map<string, SessionStatus>) {
  mock.env(on, { HOME, CLAUDE_CONFIG_DIR: `${HOME}/.claude-accounts/homes/claude-b` })
  mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.id', () => ({ value: 's-web' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.surface', () => ({ value: null }))
  on('session.usage', () => ({
    value: {
    startedAt: NOW - 1000,
    context: { tokens: 50000, window: 200000, percent: 25 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-21T12:00:00Z' },
      { kind: 'seven_day', percentUsed: 18.5, resetsAt: '2026-10-25T09:00:00Z' },
    ],
    cost: { usd: 0.42 },
    },
  }))
  on('fs.read', ($, e) => {
    if (e.path === `${HOME}/.claude-accounts/config.json`) return { value: JSON.stringify(CONFIG) }
    const written = writes.get(e.path)

    return written ? { value: JSON.stringify(written) } : { deny: `ENOENT ${e.path}` }
  })
  on('fs.write', ($, e) => {
    writes.set(e.path, JSON.parse(e.text) as SessionStatus)

    return { value: undefined }
  })
  on('fs.list', () => ({
    value: [...writes.keys()].map(path => ({
      name: path.split('/').pop() ?? path,
      kind: 'file' as const,
      size: 1,
      mtimeMs: NOW,
      isLink: false,
    })),
  }))
  on('tool.call', { tool: 'TaskCreate' }, ($, e) => ({ result: { task: { id: '1', subject: e.subject } } }))
  on('tool.call', { tool: 'TaskUpdate' }, ($, e) => ({
    result: { success: true, taskId: e.taskId, updatedFields: ['status'] },
  }))
}

const FILE = `${HOME}/.claude-accounts/status/s-web.json`

describe('reporting a session', () => {
  test('writes the account, project, limits, context and current work', async ($, on) => {
    const writes = new Map<string, SessionStatus>()
    engine(on, writes)

    await $.session.start({ cwd: `${HOME}/code/web-app/server`, surface: null, isInteractive: false })
    expect(writes.get(FILE)?.account).toBe('claude-b')
    expect(writes.get(FILE)?.project).toBe('web-app')
    expect(writes.get(FILE)?.state).toBe('idle')

    await $.prompt.submit({ text: 'Fix the login page\nand its tests', wait: false, origin: { kind: 'composer' } })
    expect(writes.get(FILE)?.state).toBe('working')
    expect(writes.get(FILE)?.lastPrompt).toBe('Fix the login page')

    await $.tool.call({ tool: 'TaskCreate', subject: 'Fix login', description: 'd', activeForm: 'Fixing login' })
    await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress' })
    expect(writes.get(FILE)?.task).toBe('Fixing login')
    expect(writes.get(FILE)?.context.percent).toBe(25)
    expect(writes.get(FILE)?.rateLimits[0]?.percentUsed).toBe(42)

    await $.session.end({ reason: 'other', sessionId: 's-web', resume: { id: 's-web' } })
    expect(writes.get(FILE)?.state).toBe('ended')
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`the /accounts pane shows each account with its limits and sessions (${surface})`, async ($, on) => {
      const writes = new Map<string, SessionStatus>()
      engine(on, writes)
      await $.session.start({ cwd: `${HOME}/code/web-app`, surface: null, isInteractive: false })

      const ui = await $.ui.mount({
        plugin: 'account-status',
        surface,
        component: 'Pane',
        requestId: 'accounts',
        props: {
          title: 'Claude accounts',
          bodyColumns: 100,
          isFocused: false,
          placement: 'dock',
          scroll: { offset: 0, bodyRows: 30 },
          view: {},
        },
      })

      expect(await ui.find({ type: 'Text', text: 'claude-a' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'no reading yet' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'claude-b' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: '42%' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'web-app · web-app' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'worker · ★ active' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'desktop app + worker' })).toBeDefined()
    })
  }
})
