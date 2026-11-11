import { describe, expect, test } from 'claude-code/testing'

import {
  createdIdOf,
  expandHome,
  groupsOf,
  isInside,
  parseCommand,
  parseConfig,
  pickFolder,
  sessionOf,
  summary,
  withProjectRule,
} from '../hooks/folders'

const HOME = '/home/demo'

function text(value: unknown) {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], isError: false }
}

describe('the rules file', () => {
  test('a missing, empty or broken file means no rules', () => {
    for (const input of [null, '', '{ not json', '[]', '42']) {
      expect(parseConfig(input)).toEqual({ followParent: true, rules: [] })
    }
  })

  test('reads rules in order, takes a single string as a list, and skips rules with no name', () => {
    const config = parseConfig(
      JSON.stringify({
        followParent: false,
        rules: [
          { name: ' Reviews ', titles: 'review' },
          { projects: ['~/shop'] },
          { name: 'Shop', projects: ['~/shop', 7, ''] },
        ],
      }),
    )
    expect(config).toEqual({
      followParent: false,
      rules: [
        { name: 'Reviews', projects: [], titles: ['review'] },
        { name: 'Shop', projects: ['~/shop'], titles: [] },
      ],
    })
  })
})

describe('which folder a chat goes in', () => {
  const config = parseConfig(
    JSON.stringify({
      rules: [
        { name: 'Reviews', titles: ['Review', 'PR #'] },
        { name: 'Shop', projects: ['~/code/shop/'] },
        { name: 'Everything else', projects: ['~'] },
      ],
    }),
  )

  test('a project rule matches the folder itself and anything inside it, not a look-alike', () => {
    expect(pickFolder(config, { cwd: `${HOME}/code/shop`, title: null, home: HOME })).toBe('Shop')
    expect(pickFolder(config, { cwd: `${HOME}/code/shop/api`, title: null, home: HOME })).toBe('Shop')
    expect(pickFolder(config, { cwd: `${HOME}/code/shop-old`, title: null, home: HOME })).toBe('Everything else')
    expect(pickFolder(config, { cwd: '/tmp/x', title: null, home: HOME })).toBeNull()
  })

  test('a title rule matches any case, and the first matching rule wins', () => {
    expect(pickFolder(config, { cwd: `${HOME}/code/shop`, title: '⏳ 2/5 review the cart', home: HOME })).toBe('Reviews')
    expect(pickFolder(config, { cwd: '/tmp/x', title: 'Fix the cart', home: HOME })).toBeNull()
  })

  test('home folder paths expand, and trailing slashes do not matter', () => {
    expect(expandHome('~', HOME)).toBe(HOME)
    expect(expandHome('~/a/', HOME)).toBe(`${HOME}/a`)
    expect(expandHome('/', HOME)).toBe('/')
    expect(isInside('/a/b/', '/a/b')).toBe(true)
    expect(isInside('/a/bc', '/a/b')).toBe(false)
  })
})

describe('/folder', () => {
  test('reads what is asked', () => {
    expect(parseCommand('')).toEqual({ kind: 'show' })
    expect(parseCommand('  None ')).toEqual({ kind: 'clear' })
    expect(parseCommand('Code reviews')).toEqual({ kind: 'move', name: 'Code reviews', remember: false })
    expect(parseCommand('--project Shop work')).toEqual({ kind: 'move', name: 'Shop work', remember: true })
  })

  test('adds a project to a rule of the same name, or a new rule, keeping the rest of the file', () => {
    const before = JSON.stringify({ followParent: false, rules: [{ name: 'shop', titles: ['cart'] }], note: 'mine' })
    const after = JSON.parse(withProjectRule(before, 'Shop', '~/code/shop'))
    expect(after).toEqual({ followParent: false, note: 'mine', rules: [{ name: 'shop', titles: ['cart'], projects: ['~/code/shop'] }] })

    expect(JSON.parse(withProjectRule(JSON.stringify(after), 'Shop', '~/code/shop')).rules[0].projects).toEqual(['~/code/shop'])
    expect(JSON.parse(withProjectRule(null, 'Docs', '~/docs'))).toEqual({ followParent: true, rules: [{ name: 'Docs', projects: ['~/docs'] }] })
  })

  test('says where the chat is and lists the folders', () => {
    const groups = [{ id: 'g1', name: 'Shop', count: 3 }]
    expect(summary('Shop', groups, '~/.claude/sidebar-folders.json')).toContain('This chat is in "Shop".\nFolders: Shop (3).')
    expect(summary(null, [], 'x')).toContain('This chat is not in a folder.\nThere are no folders yet.')
  })
})

describe("the app's answers", () => {
  test('a session: title, folder and parent; a detached chat has no parent', () => {
    expect(sessionOf(text({ title: 'Fix', group: { id: 'g1', name: 'Shop' }, parentSessionId: 'local_p' }))).toEqual({
      title: 'Fix',
      groupId: 'g1',
      groupName: 'Shop',
      parentId: 'local_p',
    })
    expect(sessionOf(text({ title: '', group: null, parentSessionId: 'local_p', detached: true }))).toEqual({
      title: null,
      groupId: null,
      groupName: null,
      parentId: null,
    })
  })

  test('folders: a JSON list, or none when the app says so in words', () => {
    expect(groupsOf(text([{ id: 'g1', name: 'Shop', session_count: 2, order: 0 }]))).toEqual([{ id: 'g1', name: 'Shop', count: 2 }])
    expect(groupsOf(text('No custom sidebar groups.'))).toEqual([])
  })

  test('a new folder id, from structured or text answers', () => {
    expect(createdIdOf({ content: [], isError: false, structuredContent: { id: 'g9' } })).toBe('g9')
    expect(createdIdOf(text({ id: 'g8', name: 'x' }))).toBe('g8')
    expect(createdIdOf(text('Created.'))).toBeNull()
  })
})
