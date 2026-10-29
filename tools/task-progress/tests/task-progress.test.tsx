import { describe, expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'task-progress',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop'] as const

// Stands in for Claude Code beneath the mod: the task tools answer as the real ones do, and the band is empty.
function engine(on: On) {
  let nextId = 1

  on('tool.call', { tool: 'TaskCreate' }, ($, e) => ({
    result: { task: { id: String(nextId++), subject: e.subject } },
  }))
  on('tool.call', { tool: 'TaskUpdate' }, ($, e) => ({
    result: { success: true, taskId: e.taskId, updatedFields: ['status'] },
  }))
  on('tool.call', { tool: 'TaskList' }, () => ({
    result: { tasks: [{ id: '7', subject: 'Fix the login page', status: 'in_progress', blockedBy: [] }] },
  }))
  on('tool.call', { tool: 'TodoWrite' }, ($, e) => ({ result: { oldTodos: [], newTodos: e.todos } }))
  on('tool.call', { tool: 'mcp__ccd_turn__update_plan' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'mcp__ccd_turn__wrap_up' }, () => ({ result: 'ok' }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Box } = $.ui.resolve(e)

    return <Box key="engine-band" />
  })
}

describe('task-progress band', () => {
  for (const surface of SURFACES) {
    test(`stays out of the way until Claude makes a plan (${surface})`, async ($, on) => {
      engine(on)
      const ui = await $.ui.mount({ ...BAND, surface })

      expect(await ui.find({ key: 'task-progress' })).toBeUndefined()
      expect(await ui.find({ key: 'engine-band' })).toBeDefined()
    })

    test(`counts steps as Claude finishes them (${surface})`, async ($, on) => {
      engine(on)
      const ui = await $.ui.mount({ ...BAND, surface })

      await $.tool.call({ tool: 'TaskCreate', subject: 'Read the code', description: 'd' })
      await $.tool.call({ tool: 'TaskCreate', subject: 'Run tests', description: 'd', activeForm: 'Running tests' })
      await $.tool.call({ tool: 'TaskCreate', subject: 'Open the PR', description: 'd' })
      await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
      await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'in_progress' })

      expect(await ui.find({ type: 'Text', text: '1 of 3 done' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Running tests' })).toBeDefined()

      await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'completed' })

      expect(await ui.find({ type: 'Text', text: '2 of 3 done' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Running tests' })).toBeUndefined()
    })

    test(`leaves deleted steps out of the count (${surface})`, async ($, on) => {
      engine(on)
      const ui = await $.ui.mount({ ...BAND, surface })

      await $.tool.call({ tool: 'TaskCreate', subject: 'Keep', description: 'd' })
      await $.tool.call({ tool: 'TaskCreate', subject: 'Drop', description: 'd' })
      await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'deleted' })

      expect(await ui.find({ type: 'Text', text: '0 of 1 done' })).toBeDefined()
    })

    test(`reads a TodoWrite checklist too (${surface})`, async ($, on) => {
      engine(on)
      const ui = await $.ui.mount({ ...BAND, surface })

      await $.tool.call({
        tool: 'TodoWrite',
        todos: [
          { content: 'Plan', status: 'completed', activeForm: 'Planning' },
          { content: 'Build', status: 'in_progress', activeForm: 'Building' },
          { content: 'Ship', status: 'pending', activeForm: 'Shipping' },
          { content: 'Tell the team', status: 'pending', activeForm: 'Telling the team' },
        ],
      })

      expect(await ui.find({ type: 'Text', text: '1 of 4 done' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Building' })).toBeDefined()
    })

    test(`reads the desktop app's update_plan list (${surface})`, async ($, on) => {
      engine(on)
      const ui = await $.ui.mount({ ...BAND, surface })

      await $.tool.call({
        tool: 'mcp__ccd_turn__update_plan',
        scope: 'turn',
        items: [
          { content: 'Read the code', status: 'completed' },
          { content: 'Fix the bug', status: 'in_progress' },
          { content: 'Run tests', status: 'pending' },
        ],
      })

      expect(await ui.find({ type: 'Text', text: '1 of 3 done' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Fix the bug' })).toBeDefined()
    })

    test(`moves through update_plan's advance and step numbers (${surface})`, async ($, on) => {
      engine(on)
      const ui = await $.ui.mount({ ...BAND, surface })

      await $.tool.call({
        tool: 'mcp__ccd_turn__update_plan',
        items: [
          { content: 'One', status: 'in_progress' },
          { content: 'Two', status: 'pending' },
          { content: 'Three', status: 'pending' },
          { content: 'Four', status: 'pending' },
        ],
      })
      await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true })

      expect(await ui.find({ type: 'Text', text: '1 of 4 done' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Two' })).toBeDefined()

      await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', done: [2, 3], start: 4 })

      expect(await ui.find({ type: 'Text', text: '3 of 4 done' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Four' })).toBeDefined()

      // After the last step, advance just finishes it.
      await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', advance: true })

      expect(await ui.find({ type: 'Text', text: 'All 4 done' })).toBeDefined()
    })

    test(`checks off the whole list on wrap_up (${surface})`, async ($, on) => {
      engine(on)
      const ui = await $.ui.mount({ ...BAND, surface })

      await $.tool.call({
        tool: 'mcp__ccd_turn__update_plan',
        items: [
          { content: 'One', status: 'in_progress' },
          { content: 'Two', status: 'pending' },
        ],
      })
      await $.tool.call({ tool: 'mcp__ccd_turn__wrap_up' })

      expect(await ui.find({ type: 'Text', text: 'All 2 done' })).toBeDefined()
    })

    test(`ignores an update_plan list it cannot read (${surface})`, async ($, on) => {
      engine(on)
      const ui = await $.ui.mount({ ...BAND, surface })

      await $.tool.call({ tool: 'mcp__ccd_turn__update_plan', items: [{ content: 'One', status: 'maybe' }] })

      expect(await ui.find({ key: 'task-progress' })).toBeUndefined()
    })

    test(`keeps a finished plan until the next prompt (${surface})`, async ($, on) => {
      engine(on)
      const ui = await $.ui.mount({ ...BAND, surface })

      await $.tool.call({ tool: 'TaskCreate', subject: 'One', description: 'd' })
      await $.tool.call({ tool: 'TaskCreate', subject: 'Two', description: 'd' })
      await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })
      await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'completed' })

      expect(await ui.find({ type: 'Text', text: 'All 2 done' })).toBeDefined()

      await $.prompt.submit({ text: 'thanks', wait: false, origin: { kind: 'composer' } })

      expect(await ui.find({ key: 'task-progress' })).toBeUndefined()

      await $.tool.call({ tool: 'TaskCreate', subject: 'Three', description: 'd' })

      expect(await ui.find({ type: 'Text', text: '2 of 3 done' })).toBeDefined()
    })

    test(`hides on request until the plan changes (${surface})`, async ($, on) => {
      engine(on)
      const ui = await $.ui.mount({ ...BAND, surface })

      await $.tool.call({ tool: 'TaskCreate', subject: 'One', description: 'd' })
      await $.tool.call({ tool: 'TaskCreate', subject: 'Two', description: 'd' })
      await ui.press({ key: 'hide' })

      expect(await ui.find({ key: 'task-progress' })).toBeUndefined()

      await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' })

      expect(await ui.find({ type: 'Text', text: '1 of 2 done' })).toBeDefined()
    })

    test(`picks up tasks made before it loaded (${surface})`, async ($, on) => {
      engine(on)
      const ui = await $.ui.mount({ ...BAND, surface })

      await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress' })

      expect(await ui.find({ type: 'Text', text: 'Task 7' })).toBeDefined()

      await $.tool.call({ tool: 'TaskList' })

      expect(await ui.find({ type: 'Text', text: '0 of 1 done' })).toBeDefined()
      expect(await ui.find({ type: 'Text', text: 'Fix the login page' })).toBeDefined()
    })

    test(`starts over after /clear (${surface})`, async ($, on) => {
      engine(on)
      const ui = await $.ui.mount({ ...BAND, surface })

      await $.tool.call({ tool: 'TaskCreate', subject: 'One', description: 'd' })
      await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })

      expect(await ui.find({ key: 'task-progress' })).toBeUndefined()
    })
  }
})
