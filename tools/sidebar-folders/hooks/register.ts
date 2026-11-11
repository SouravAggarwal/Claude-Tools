import type { EngineInterface, Register } from 'claude-code'

import {
  createdIdOf,
  summary,
  groupsOf,
  parseCommand,
  parseConfig,
  pickFolder,
  sameName,
  sessionOf,
  withProjectRule,
} from './folders'

// The desktop app's own MCP servers: one knows each chat, the other the sidebar's folders.
const SESSIONS_SERVER = 'ccd_session_mgmt'
const SIDEBAR_SERVER = 'ccd_sidebar'
const RULES_FILE = 'sidebar-folders.json'
const FILED_DIR = 'sidebar-folders/filed'
// A new chat gets its title from the app during its first turns: look this many times, then leave it be.
const TITLE_LOOKS = 3
const NOT_DESKTOP = "Folders live in the Claude desktop app's sidebar, so /folder works only in a chat there."

type Chat = {
  home: string
  configDir: string
  cwd: string
  /** The desktop app's id for this chat; null in a terminal, where there is no sidebar. */
  hostId: string | null
  /** Decided: in a folder, or left out of one on purpose. Never moved again by a rule. */
  isFiled: boolean
  looks: number
}

// Module state rather than $.state, which older engines lack. A reload starts it over; the marker file
// in FILED_DIR keeps "decided" across reloads and resumes.
let chat: Chat | null = null
let queue: Promise<void> = Promise.resolve()

async function paths($: EngineInterface): Promise<{ home: string; configDir: string }> {
  const [home, configDir] = await Promise.all([$.env.get('HOME'), $.env.get('CLAUDE_CONFIG_DIR')])
  const homeDir = home ?? ''

  return { home: homeDir, configDir: configDir || `${homeDir}/.claude` }
}

async function readText($: EngineInterface, path: string): Promise<string | null> {
  try {
    return await $.fs.read(path)
  } catch {
    return null
  }
}

async function call($: EngineInterface, server: string, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const answer = await $.mcp.call(server, tool, args)
  if (answer.isError) throw new Error(`${tool} refused`)

  return answer
}

// The id of the folder with this name (any case), made when there is none yet.
async function folderId($: EngineInterface, name: string): Promise<string> {
  const listed = groupsOf(await call($, SIDEBAR_SERVER, 'list_groups', {})).find(group => sameName(group.name, name))
  if (listed !== undefined) return listed.id
  const created = createdIdOf(await call($, SIDEBAR_SERVER, 'create_group', { name }))
  if (created !== null) return created
  const found = groupsOf(await call($, SIDEBAR_SERVER, 'list_groups', {})).find(group => sameName(group.name, name))
  if (found === undefined) throw new Error('folder not found after create_group')

  return found.id
}

async function moveSelf($: EngineInterface, groupId: string | null): Promise<void> {
  await call($, SIDEBAR_SERVER, 'move_sessions', { session_ids: ['self'], group_id: groupId })
}

async function markFiled($: EngineInterface): Promise<void> {
  if (chat === null) return
  chat.isFiled = true
  if (chat.hostId === null) return
  try {
    await $.fs.write(`${chat.configDir}/${FILED_DIR}/${chat.hostId}`, `${await $.clock.now()}\n`)
  } catch {
    // Without the marker a resumed chat is looked at once more; a chat already in a folder stays put anyway.
  }
}

// The app starts some chats ahead of time, in a spare folder and before it knows which chat they will be,
// so what session.start saw can be out of date: read the folder, and the chat's id if still missing, again.
async function refreshChat($: EngineInterface, current: Chat): Promise<void> {
  try {
    current.cwd = await $.session.cwd()
  } catch {
    // An engine without $.session.cwd keeps the folder the session started in.
  }
  if (current.hostId !== null) return
  current.hostId = (await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')) || null
  if (current.hostId !== null && (await readText($, `${current.configDir}/${FILED_DIR}/${current.hostId}`)) !== null) {
    current.isFiled = true
  }
}

// Files this chat once: into its parent's folder, or the first rule's that matches. A chat already in a
// folder, or one the person moved, is never moved. While the app is not ready, the next turn tries again.
async function fileOnce($: EngineInterface, isAfterTurn: boolean): Promise<void> {
  if (chat === null || chat.isFiled) return
  try {
    await refreshChat($, chat)
    if (chat.hostId === null || chat.isFiled) return
    const config = parseConfig(await readText($, `${chat.configDir}/${RULES_FILE}`))
    const self = sessionOf(await call($, SESSIONS_SERVER, 'get_session', { session_id: 'self' }))
    if (self.groupId !== null) return await markFiled($)

    if (config.followParent && self.parentId !== null) {
      const parent = sessionOf(await call($, SESSIONS_SERVER, 'get_session', { session_id: self.parentId }))
      if (parent.groupId !== null) {
        await moveSelf($, parent.groupId)
        return await markFiled($)
      }
    }

    const name = pickFolder(config, { cwd: chat.cwd, title: self.title, home: chat.home })
    if (name !== null) {
      await moveSelf($, await folderId($, name))
      return await markFiled($)
    }

    if (isAfterTurn) {
      chat.looks += 1
      if (chat.looks >= TITLE_LOOKS) await markFiled($)
    }
  } catch {
    // The app is not ready yet, or refused: the next turn tries again.
  }
}

function queueFiling($: EngineInterface, isAfterTurn: boolean): Promise<void> {
  queue = queue.then(() => fileOnce($, isAfterTurn)).catch(() => undefined)

  return queue
}

async function runCommand($: EngineInterface, args: string): Promise<string> {
  const command = parseCommand(args)
  if (chat !== null) await refreshChat($, chat)
  const { home, configDir } = chat ?? (await paths($))
  const rulesPath = `${configDir}/${RULES_FILE}`
  if (chat?.hostId === null) return NOT_DESKTOP

  if (command.kind === 'show') {
    const self = sessionOf(await call($, SESSIONS_SERVER, 'get_session', { session_id: 'self' }))
    const groups = await call($, SIDEBAR_SERVER, 'list_groups', {})
      .then(groupsOf)
      .catch(() => [])

    return summary(self.groupName, groups, rulesPath.replace(home, '~'))
  }

  if (command.kind === 'clear') {
    await moveSelf($, null)
    await markFiled($)

    return 'Took this chat out of its folder. Rules will not move it again.'
  }

  await moveSelf($, await folderId($, command.name))
  await markFiled($)
  if (!command.remember) return `Moved this chat to "${command.name}".`

  const cwd = chat?.cwd ?? ''
  const project = home !== '' && cwd.startsWith(`${home}/`) ? `~${cwd.slice(home.length)}` : cwd
  await $.fs.write(rulesPath, withProjectRule(await readText($, rulesPath), command.name, project))

  return `Moved this chat to "${command.name}". New chats in ${project} will go there too.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const answer = await next(e)
    try {
      const [{ home, configDir }, hostId] = await Promise.all([paths($), $.env.get('CLAUDE_CODE_HOST_SESSION_ID')])
      chat = { home, configDir, cwd: e.cwd, hostId: hostId || null, isFiled: false, looks: 0 }
      await $.command.register({
        name: 'folder',
        description: "Put this chat in a sidebar folder (made if new), or show this chat's folder",
        argumentHint: '[name] [--project] | none',
      })
      if (chat.hostId !== null && (await readText($, `${configDir}/${FILED_DIR}/${chat.hostId}`)) !== null) {
        chat.isFiled = true
      }
      // Not awaited: the app's servers may still be starting, and the chat must not wait on them.
      void queueFiling($, false)
    } catch {
      chat = null
    }

    return answer
  })

  on('turn.start', async ($, e, next) => {
    const answer = await next(e)
    if (e.agentId === undefined) void queueFiling($, false)

    return answer
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const answer = await next(e)
    if (e.agentId === undefined) await queueFiling($, true)

    return answer
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'folder' }, async ($, e) => {
    try {
      return { text: await runCommand($, e.args) }
    } catch {
      return { text: `Could not reach the sidebar. ${NOT_DESKTOP}` }
    }
  })
}
