export type StepStatus = 'pending' | 'in_progress' | 'completed'

export type Step = {
  id: string
  title: string
  /** The "Running tests" form Claude gives a step while it works on it. */
  activeTitle: string | null
  status: StepStatus
}

export type Plan = {
  steps: Step[]
  /** The steps' signature when the band was put away; it shows again once they change. */
  hiddenAt: string | null
}

export const EMPTY_PLAN: Plan = { steps: [], hiddenAt: null }

type Todo = { content: string; status: StepStatus; activeForm: string }
type ListedTask = { id: string; subject: string; status: StepStatus }
type StepChange = {
  title?: string
  activeTitle?: string
  status?: StepStatus | 'deleted'
}

// TodoWrite sends the whole list every time, so it replaces what we hold.
export function fromTodos(todos: readonly Todo[]): Step[] {
  return todos.map((todo, index) => ({
    id: `todo-${index}`,
    title: todo.content,
    activeTitle: todo.activeForm || null,
    status: todo.status,
  }))
}

// TaskList is the source of truth; it carries no activeForm, so keep ours.
export function fromTaskList(tasks: readonly ListedTask[], previous: readonly Step[]): Step[] {
  return tasks.map(task => ({
    id: task.id,
    title: task.subject,
    activeTitle: previous.find(step => step.id === task.id)?.activeTitle ?? null,
    status: task.status,
  }))
}

export function upsertStep(steps: readonly Step[], step: Step): Step[] {
  const exists = steps.some(existing => existing.id === step.id)

  return exists ? steps.map(existing => (existing.id === step.id ? step : existing)) : [...steps, step]
}

export function changeStep(steps: readonly Step[], id: string, change: StepChange): Step[] {
  if (change.status === 'deleted') {
    return steps.filter(step => step.id !== id)
  }

  const status = change.status
  const current = steps.find(step => step.id === id)

  // A task made before this session loaded the mod: count it, named by its id until TaskList names it.
  const base: Step = current ?? { id, title: `Task ${id}`, activeTitle: null, status: 'pending' }

  return upsertStep(steps, {
    ...base,
    title: change.title ?? base.title,
    activeTitle: change.activeTitle ?? base.activeTitle,
    status: status ?? base.status,
  })
}

const STATUSES: readonly string[] = ['pending', 'in_progress', 'completed']

// The desktop app's update_plan sends its input as loose MCP arguments, so each item is checked before it counts.
export function fromPlanItems(items: unknown): Step[] | null {
  if (!Array.isArray(items)) {
    return null
  }

  const steps: Step[] = []

  for (const item of items) {
    if (typeof item !== 'object' || item === null) {
      return null
    }

    const { content, status } = item as { content?: unknown; status?: unknown }

    if (typeof content !== 'string' || typeof status !== 'string' || !STATUSES.includes(status)) {
      return null
    }

    steps.push({ id: `plan-${steps.length}`, title: content, activeTitle: null, status: status as StepStatus })
  }

  return steps
}

// update_plan's { advance: true }: finish the running step and start the next waiting one.
export function advancePlan(steps: readonly Step[]): Step[] {
  const finished = steps.map(step => (step.status === 'in_progress' ? { ...step, status: 'completed' as const } : step))
  const next = finished.findIndex(step => step.status === 'pending')

  return finished.map((step, index) => (index === next ? { ...step, status: 'in_progress' as const } : step))
}

// update_plan's { done: [n], start: m }: step numbers count from 1.
export function markPlan(steps: readonly Step[], done: readonly number[], start: number | null): Step[] {
  return steps.map((step, index) => {
    if (done.includes(index + 1)) {
      return { ...step, status: 'completed' as const }
    }

    if (start === index + 1) {
      return { ...step, status: 'in_progress' as const }
    }

    return step
  })
}

// wrap_up ends the turn's work and checks off the whole list.
export function completeAll(steps: readonly Step[]): Step[] {
  return steps.map(step => ({ ...step, status: 'completed' as const }))
}

// The desktop app's own plan tool, used there instead of TodoWrite and the Task tools.
export const UPDATE_PLAN = 'mcp__ccd_turn__update_plan'
export const WRAP_UP = 'mcp__ccd_turn__wrap_up'

function stepNumbers(value: unknown): number[] {
  const values = Array.isArray(value) ? value : [value]

  return values.filter((n): n is number => typeof n === 'number' && Number.isInteger(n))
}

// One update_plan call: a whole new list, an advance, or step numbers to finish and start.
export function planChange(e: { [argument: string]: unknown }): ((steps: readonly Step[]) => Step[]) | null {
  const items = fromPlanItems(e.items)

  if (items !== null) {
    return () => items
  }

  if (e.advance === true) {
    return advancePlan
  }

  const done = stepNumbers(e.done)
  const start = typeof e.start === 'number' && Number.isInteger(e.start) ? e.start : null

  return done.length > 0 || start !== null ? steps => markPlan(steps, done, start) : null
}

type Loose = { readonly [field: string]: unknown }

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function status(value: unknown): StepStatus | 'deleted' | undefined {
  return value === 'deleted' || (typeof value === 'string' && STATUSES.includes(value))
    ? (value as StepStatus | 'deleted')
    : undefined
}

function asLoose(value: unknown): Loose | null {
  return typeof value === 'object' && value !== null ? (value as Loose) : null
}

// Every plan tool in one place, for an add-on that watches all tool calls: the steps after a call that
// succeeded, or null when the call says nothing about the plan. `input` is the call, `result` its answer.
export function stepsAfterCall(steps: readonly Step[], input: Loose, result: unknown): Step[] | null {
  const answer = asLoose(result)

  switch (input.tool) {
    case 'TodoWrite':
      return Array.isArray(answer?.newTodos) ? fromTodos(answer.newTodos as Todo[]) : null
    case 'TaskCreate': {
      const id = text(asLoose(answer?.task)?.id)
      const title = text(input.subject)

      return id && title ? upsertStep(steps, { id, title, activeTitle: text(input.activeForm) ?? null, status: 'pending' }) : null
    }
    case 'TaskUpdate': {
      const id = text(input.taskId)

      return id && answer?.success === true
        ? changeStep(steps, id, { title: text(input.subject), activeTitle: text(input.activeForm), status: status(input.status) })
        : null
    }
    case 'TaskList':
      return Array.isArray(answer?.tasks) ? fromTaskList(answer.tasks as ListedTask[], steps) : null
    case 'TaskGet': {
      const task = asLoose(answer?.task)
      const id = text(task?.id)

      return task && id ? changeStep(steps, id, { title: text(task.subject), status: status(task.status) }) : null
    }
    case UPDATE_PLAN: {
      const change = planChange(input)

      return change === null ? null : change(steps)
    }
    case WRAP_UP:
      return completeAll(steps)
    default:
      return null
  }
}

export function signature(steps: readonly Step[]): string {
  return steps.map(step => `${step.id}:${step.status}`).join('|')
}

export type Progress = {
  done: number
  total: number
  current: string | null
  isComplete: boolean
}

export function progressOf(steps: readonly Step[]): Progress {
  const done = steps.filter(step => step.status === 'completed').length
  const running = steps.find(step => step.status === 'in_progress')

  return {
    done,
    total: steps.length,
    current: running ? (running.activeTitle ?? running.title) : null,
    isComplete: steps.length > 0 && done === steps.length,
  }
}

export function isShown(plan: Plan): boolean {
  return plan.steps.length > 0 && plan.hiddenAt !== signature(plan.steps)
}

export function filledCells(progress: Progress, width: number): number {
  return progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * width)
}
