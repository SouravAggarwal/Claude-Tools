import { describe, expect, test } from 'claude-code/testing'

import {
  createdIdOf,
  expandHome,
  groupsOf,
  isInside,
  parseCommand,
  parseConfig,
  findGroup,
  pickRule,
  sessionOf,
  summary,
  withProjectRule,
  withRuleFolder,
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
        { name: 'Reviews', id: null, projects: [], titles: ['review'] },
        { name: 'Shop', id: null, projects: ['~/shop'], titles: [] },
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
    expect(pickRule(config, { cwd: `${HOME}/code/shop`, title: null, home: HOME })?.name).toBe('Shop')
    expect(pickRule(config, { cwd: `${HOME}/code/shop/api`, title: null, home: HOME })?.name).toBe('Shop')
    expect(pickRule(config, { cwd: `${HOME}/code/shop-old`, title: null, home: HOME })?.name).toBe('Everything else')
    expect(pickRule(config, { cwd: '/tmp/x', title: null, home: HOME })?.name ?? null).toBeNull()
  })

  test('a title rule matches any case, and the first matching rule wins', () => {
    expect(pickRule(config, { cwd: `${HOME}/code/shop`, title: '⏳ 2/5 review the cart', home: HOME })?.name).toBe('Reviews')
    expect(pickRule(config, { cwd: '/tmp/x', title: 'Fix the cart', home: HOME })?.name ?? null).toBeNull()
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

  test('adds a project to the folder\'s rule, or a new rule, keeping the rest of the file', () => {
    const before = JSON.stringify({ followParent: false, rules: [{ name: 'shop', titles: ['cart'] }], note: 'mine' })
    const shop = { id: 'g1', name: 'Shop' }
    const after = JSON.parse(withProjectRule(before, shop, '~/code/shop'))
    expect(after).toEqual({ followParent: false, note: 'mine', rules: [{ name: 'shop', titles: ['cart'], id: 'g1', projects: ['~/code/shop'] }] })

    // Found by its id after the folder was renamed in the sidebar; the project is not added twice.
    const renamed = JSON.parse(withProjectRule(JSON.stringify(after), { id: 'g1', name: '🛒 Store' }, '~/code/shop'))
    expect(renamed.rules).toEqual(after.rules)
    expect(JSON.parse(withProjectRule(null, { id: 'g2', name: 'Docs' }, '~/docs'))).toEqual({
      followParent: true,
      rules: [{ name: 'Docs', id: 'g2', projects: ['~/docs'] }],
    })
    expect(() => withProjectRule('{"rules": [', shop, '~/x')).toThrow()
  })

  test('finds a folder by the saved id, then by name, then by the one name left once emoji go', () => {
    const groups = [
      { id: 'g1', name: '🟢 Garden', count: 0 },
      { id: 'g2', name: 'Reviews', count: 0 },
      { id: 'g3', name: 'C++', count: 0 },
      { id: 'g4', name: '🟢 Shop', count: 0 },
      { id: 'g5', name: '🔴 Shop', count: 0 },
    ]
    expect(findGroup(groups, 'Old name', 'g2')?.id).toBe('g2')
    expect(findGroup(groups, 'reviews', 'gone')?.id).toBe('g2')
    expect(findGroup(groups, 'Garden')?.id).toBe('g1')
    expect(findGroup(groups, 'C')).toBeUndefined()
    expect(findGroup(groups, 'Shop')).toBeUndefined()
    expect(findGroup(groups, '🔴')).toBeUndefined()
  })

  test('saves the folder id in the rule it belongs to, keeping its name, and never writes over a broken file', () => {
    const before = JSON.stringify({ rules: [{ name: 'Work', titles: ['x'], id: 'g9' }, { name: 'Work', projects: ['~/w'] }] })
    const after = withRuleFolder(before, { name: 'Work', id: null }, 'g1')
    expect(JSON.parse(after ?? '{}').rules).toEqual([
      { name: 'Work', titles: ['x'], id: 'g9' },
      { name: 'Work', projects: ['~/w'], id: 'g1' },
    ])
    expect(withRuleFolder(after, { name: 'Work', id: 'g1' }, 'g1')).toBeNull()
    expect(withRuleFolder('{"rules": [', { name: 'Work', id: null }, 'g1')).toBeNull()
    expect(parseConfig(after).rules.map(rule => rule.id)).toEqual(['g9', 'g1'])
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
