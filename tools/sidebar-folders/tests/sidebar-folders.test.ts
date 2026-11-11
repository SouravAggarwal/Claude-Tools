import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const HOME = '/home/demo'
const HOST_ID = 'local_0b8a41f2-demo'
const RULES = `${HOME}/.claude/sidebar-folders.json`
const MARK = `${HOME}/.claude/sidebar-folders/filed/${HOST_ID}`

type Group = { id: string; name: string }

type World = {
  files: Map<string, string>
  groups: Group[]
  /** This chat as the app knows it. */
  self: { title: string; groupId: string | null; parentSessionId?: string }
  /** Other chats' folders, by session id. */
  others: Record<string, string | null>
  /** Every move_sessions call, as the folder id asked for. */
  moves: (string | null)[]
  /** The app's servers answer nothing (a terminal, or the app still starting). */
  isOffline: boolean
}

function world(over: Partial<World> = {}): World {
  return { files: new Map(), groups: [], self: { title: '', groupId: null }, others: {}, moves: [], isOffline: false, ...over }
}

function answer(value: unknown) {
  return { value: { content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value) }], isError: false } }
}

function groupOf(w: World, id: string | null) {
  const group = w.groups.find(item => item.id === id)

  return group === undefined ? null : { id: group.id, name: group.name }
}

// Stands in for Claude Code and the desktop app beneath the mod. Nothing runs for real.
function engine(on: On, w: World, env: Record<string, string> = { HOME, CLAUDE_CODE_HOST_SESSION_ID: HOST_ID }) {
  mock.env(on, env)
  mock.clock(on, { now: 1_000 })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('fs.read', ($, e) => {
    const text = w.files.get(e.path)

    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('fs.write', ($, e) => {
    w.files.set(e.path, e.text)

    return { value: undefined }
  })
  on('mcp.call', ($, e) => {
    if (w.isOffline) return { deny: 'no such server' }
    const args = e.args as Record<string, unknown>
    switch (`${e.server}/${e.tool}`) {
      case 'ccd_session_mgmt/get_session': {
        if (args.session_id === 'self') {
          return answer({ title: w.self.title, group: groupOf(w, w.self.groupId), parentSessionId: w.self.parentSessionId })
        }
        return answer({ title: 'Parent', group: groupOf(w, w.others[String(args.session_id)] ?? null) })
      }
      case 'ccd_sidebar/list_groups':
        return answer(w.groups.length === 0 ? 'No custom sidebar groups.' : w.groups.map((group, order) => ({ ...group, session_count: 0, order })))
      case 'ccd_sidebar/create_group': {
        const group = { id: `g${w.groups.length + 1}`, name: String(args.name) }
        w.groups.push(group)
        return answer(group)
      }
      case 'ccd_sidebar/move_sessions': {
        const id = (args.group_id as string | null) ?? null
        w.moves.push(id)
        w.self.groupId = id
        return answer('Moved 1 session.')
      }
      default:
        return { deny: 'unknown tool' }
    }
  })
}

let turns = 0

async function turn($: Engine) {
  turns += 1
  await $.turn.start({ text: '', turnId: `t${turns}` })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: `t${turns}`, reason: 'answer' })
}

async function begin($: Engine, cwd = `${HOME}/code/shop`) {
  await $.session.start({ cwd, surface: 'desktop', isInteractive: true })
}

async function folder($: Engine, args: string): Promise<string> {
  const result = await $.command.run({ command: 'folder', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

  return result.text ?? ''
}

const RULES_TEXT = JSON.stringify({
  rules: [
    { name: 'Reviews', titles: ['review'] },
    { name: 'Shop', projects: ['~/code/shop'] },
  ],
})

describe('filing a new chat', () => {
  test('a project rule files it at the start, making the folder once', async ($, on) => {
    const w = world({ files: new Map([[RULES, RULES_TEXT]]) })
    engine(on, w)
    await begin($)
    await turn($)
    expect(w.groups).toEqual([{ id: 'g1', name: 'Shop' }])
    expect(w.moves).toEqual(['g1'])
    expect(w.files.has(MARK)).toBe(true)

    await turn($)
    expect(w.moves).toEqual(['g1'])
  })

  test('a title rule files it once the app has named it, into the folder that is there already', async ($, on) => {
    const w = world({ files: new Map([[RULES, RULES_TEXT]]), groups: [{ id: 'g7', name: 'reviews' }] })
    engine(on, w)
    await begin($, '/tmp/elsewhere')
    expect(w.moves).toEqual([])

    w.self.title = 'Review PR 12'
    await turn($)
    expect(w.moves).toEqual(['g7'])
    expect(w.groups).toHaveLength(1)
  })

  test('a chat started ahead of time in a spare folder is filed by the folder it works in now', async ($, on) => {
    const w = world({ files: new Map([[RULES, RULES_TEXT]]) })
    engine(on, w)
    on('session.cwd', () => ({ value: `${HOME}/code/shop` }))
    await begin($, `${HOME}/.claude/spares/spare-1`)
    await turn($)
    expect(w.moves).toEqual(['g1'])
  })

  test('while the app is not ready, the next turn tries again', async ($, on) => {
    const w = world({ files: new Map([[RULES, RULES_TEXT]]), isOffline: true })
    engine(on, w)
    await begin($)
    for (let i = 0; i < 6; i += 1) await turn($)
    expect(w.moves).toEqual([])

    w.isOffline = false
    await turn($)
    expect(w.moves).toEqual(['g1'])
  })

  test("a chat Claude started goes into its parent's folder before any rule", async ($, on) => {
    const w = world({
      files: new Map([[RULES, RULES_TEXT]]),
      groups: [{ id: 'g3', name: 'Tickets' }],
      self: { title: '', groupId: null, parentSessionId: 'local_parent' },
      others: { local_parent: 'g3' },
    })
    engine(on, w)
    await begin($)
    await turn($)
    expect(w.moves).toEqual(['g3'])
  })

  test('a chat already in a folder, or one already decided, is never moved', async ($, on) => {
    const w = world({ files: new Map([[RULES, RULES_TEXT]]), groups: [{ id: 'g5', name: 'Mine' }], self: { title: 'Review', groupId: 'g5' } })
    engine(on, w)
    await begin($)
    await turn($)
    expect(w.moves).toEqual([])
    expect(w.files.has(MARK)).toBe(true)

    // Resumed later after the person took it out of the folder: the marker keeps it out.
    w.self.groupId = null
    await begin($)
    await turn($)
    expect(w.moves).toEqual([])
  })

  test('with no rule that matches, it stops looking after a few turns', async ($, on) => {
    const w = world({ files: new Map([[RULES, RULES_TEXT]]) })
    engine(on, w)
    await begin($, '/tmp/elsewhere')
    for (let i = 0; i < 3; i += 1) await turn($)
    expect(w.files.has(MARK)).toBe(true)

    w.self.title = 'review it now'
    await turn($)
    expect(w.moves).toEqual([])
  })

  test('in a terminal, or with the app not answering, nothing breaks and nothing moves', async ($, on) => {
    const w = world({ files: new Map([[RULES, RULES_TEXT]]), isOffline: true })
    engine(on, w, { HOME })
    await begin($)
    await turn($)
    expect(w.moves).toEqual([])
    expect(await folder($, 'Shop')).toContain('works only in a chat there')
  })
})

describe('/folder', () => {
  test('moves the chat, making the folder, and with --project remembers it for the project', async ($, on) => {
    const w = world()
    engine(on, w)
    await begin($, `${HOME}/code/blog`)
    expect(await folder($, 'Writing --project')).toBe('Moved this chat to "Writing". New chats in ~/code/blog will go there too.')
    expect(w.moves).toEqual(['g1'])
    expect(JSON.parse(w.files.get(RULES) ?? '{}')).toEqual({ followParent: true, rules: [{ name: 'Writing', projects: ['~/code/blog'] }] })
  })

  test('shows where the chat is, and none takes it out for good', async ($, on) => {
    const w = world({ groups: [{ id: 'g1', name: 'Shop' }], self: { title: 'x', groupId: 'g1' } })
    engine(on, w)
    await begin($)
    expect(await folder($, '')).toContain('This chat is in "Shop".')

    expect(await folder($, 'none')).toContain('Took this chat out')
    expect(w.moves).toEqual([null])
    expect(w.files.has(MARK)).toBe(true)
  })

  test('says so when the sidebar cannot be reached', async ($, on) => {
    const w = world({ isOffline: true })
    engine(on, w)
    await begin($)
    expect(await folder($, 'Shop')).toContain('Could not reach the sidebar')
  })
})
