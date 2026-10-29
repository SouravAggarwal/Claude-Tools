import { describe, expect, test } from 'claude-code/testing'

import {
  boardRows,
  decide,
  detailOf,
  durationText,
  markerLabel,
  openArgv,
  stripMarker,
  titleFromSession,
  withMarker,
} from '../hooks/status'
import type { Facts, StatusFile } from '../hooks/status'

const QUIET: Facts = {
  turnRunning: false,
  lastEnd: null,
  asking: null,
  wrapAsk: null,
  wrappedUp: false,
  helpers: 0,
  steps: { done: 0, total: 0 },
}

const NOW = Date.parse('2026-10-29T10:00:00Z')

function file(over: Partial<StatusFile>): StatusFile {
  return {
    version: 1,
    sessionId: 's1',
    hostSessionId: 'local_1',
    state: 'idle',
    steps: { done: 0, total: 0, current: null },
    helpersRunning: 0,
    waitingReason: null,
    title: 'A chat',
    cwd: '/work/shop',
    project: 'shop',
    account: null,
    stateSince: NOW - 60_000,
    updatedAt: NOW,
    ended: false,
    ...over,
  }
}

describe('the one rule', () => {
  test('nothing yet, or stopped by the person, is idle', () => {
    expect(decide(QUIET).state).toBe('idle')
    expect(decide({ ...QUIET, lastEnd: 'aborted' }).state).toBe('idle')
  })

  test('an error or a refusal is failed, ahead of everything else', () => {
    expect(decide({ ...QUIET, lastEnd: 'error', helpers: 2 }).state).toBe('failed')
    expect(decide({ ...QUIET, lastEnd: 'refusal' })).toEqual({ state: 'failed', waitingReason: 'Claude refused' })
  })

  test('an open question needs you, even while the turn runs', () => {
    expect(decide({ ...QUIET, turnRunning: true, asking: 'Which file?' })).toEqual({ state: 'needs-you', waitingReason: 'Which file?' })
    expect(decide({ ...QUIET, lastEnd: 'answer', wrapAsk: 'Ship it?' }).state).toBe('needs-you')
  })

  test('a running turn or a helper still out is working', () => {
    expect(decide({ ...QUIET, turnRunning: true }).state).toBe('working')
    expect(decide({ ...QUIET, lastEnd: 'answer', helpers: 1 }).state).toBe('working')
    expect(decide({ ...QUIET, lastEnd: 'aborted', helpers: 1 }).state).toBe('working')
  })

  test('done only when the plan is finished or wrapped up', () => {
    expect(decide({ ...QUIET, lastEnd: 'answer' }).state).toBe('done')
    expect(decide({ ...QUIET, lastEnd: 'answer', steps: { done: 3, total: 3 } }).state).toBe('done')
    expect(decide({ ...QUIET, lastEnd: 'answer', wrappedUp: true, steps: { done: 1, total: 3 } }).state).toBe('done')
    expect(decide({ ...QUIET, lastEnd: 'answer', steps: { done: 1, total: 3 } })).toEqual({
      state: 'needs-you',
      waitingReason: 'Stopped with 2 of 3 steps left',
    })
  })
})

describe('the sidebar marker', () => {
  test('puts the marker and the count before the title', () => {
    expect(markerLabel('A', 'working', { done: 4, total: 7 })).toBe('⏳ 4/7')
    expect(markerLabel('A', 'done', { done: 7, total: 7 })).toBe('✅')
    expect(markerLabel('A', 'needs-you', { done: 0, total: 0 })).toBe('💬')
    expect(markerLabel('B', 'failed', { done: 2, total: 5 })).toBe('❗ 2/5')
    expect(markerLabel('C', 'working', { done: 0, total: 2 })).toBe('🔵 0/2')
    expect(markerLabel('A', 'idle', { done: 1, total: 2 })).toBe('')
    expect(markerLabel('off', 'working', { done: 1, total: 2 })).toBe('')
  })

  test('swaps an old marker of any set for the new one, and keeps the title', () => {
    expect(withMarker('Fix login', '⏳ 1/3')).toBe('⏳ 1/3 Fix login')
    expect(withMarker('⏳ 1/3 Fix login', '✅')).toBe('✅ Fix login')
    expect(withMarker('⚠️ 2/5 Fix login', '')).toBe('Fix login')
    expect(withMarker('🔸 Fix login', '⏳')).toBe('⏳ Fix login')
    expect(stripMarker('✔️ ❗ 1/2 Deploy')).toBe('Deploy')
    expect(stripMarker('2/5 tasks left')).toBe('2/5 tasks left')
  })

  test("reads the title from get_session's answer, whatever its shape", () => {
    expect(titleFromSession({ content: [], structuredContent: { title: 'One' }, isError: false })).toBe('One')
    expect(titleFromSession({ content: [{ type: 'text', text: '{"session":{"title":"Two"}}' }], isError: false })).toBe('Two')
    expect(titleFromSession({ content: [{ type: 'text', text: 'Title: Three' }], isError: false })).toBe('Three')
    expect(titleFromSession({ content: [{ type: 'text', text: 'nothing here' }], isError: false })).toBeNull()
  })
})

describe('the board', () => {
  test('lists needs-you first, then working, done, failed, idle', () => {
    const rows = boardRows(
      [
        file({ sessionId: 'done', state: 'done' }),
        file({ sessionId: 'idle', state: 'idle' }),
        file({ sessionId: 'failed', state: 'failed' }),
        file({ sessionId: 'working', state: 'working' }),
        file({ sessionId: 'needs', state: 'needs-you' }),
      ],
      NOW,
    )
    expect(rows.map(row => row.sessionId)).toEqual(['needs', 'working', 'done', 'failed', 'idle'])
  })

  test('a working session that went quiet shows as not running; a day-old one goes', () => {
    const [gone] = boardRows([file({ state: 'working', updatedAt: NOW - 5 * 60_000 })], NOW)
    expect(gone?.shownState).toBe('idle')
    expect(gone && detailOf(gone)).toBe('Not running')
    expect(boardRows([file({ state: 'done', updatedAt: NOW - 25 * 3600_000 })], NOW)).toEqual([])
    expect(boardRows([file({ state: 'done', updatedAt: NOW - 5 * 60_000 })], NOW)[0]?.shownState).toBe('done')
  })

  test('says what a row is on and how long it has been so', () => {
    const [row] = boardRows([file({ state: 'working', steps: { done: 1, total: 3, current: 'Running tests' }, helpersRunning: 2 })], NOW)
    expect(row && detailOf(row)).toBe('Running tests · 2 helpers running')
    expect(durationText(42_000)).toBe('42s')
    expect(durationText(5 * 60_000)).toBe('5m')
    expect(durationText(3 * 3600_000)).toBe('3h')
  })

  test('opens only a plain desktop session id', () => {
    expect(openArgv('local_0b8a-41')).toEqual(['open', 'claude://claude.ai/epitaxy/local_0b8a-41'])
    expect(openArgv('local_1; rm -rf ~')).toBeNull()
    expect(openArgv(null)).toBeNull()
  })
})
