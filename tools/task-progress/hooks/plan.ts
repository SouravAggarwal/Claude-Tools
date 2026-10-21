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
