import type { EngineInterface, Register } from 'claude-code'

import { barLabel, svgBar } from './bar'
import {
  EMPTY_PLAN,
  changeStep,
  filledCells,
  fromTaskList,
  fromTodos,
  isShown,
  progressOf,
  signature,
  upsertStep,
} from './plan'
import type { Plan, Step } from './plan'

// The plan lives in this module rather than in $.state, which older engines lack; a reload starts it empty.
let current: Plan = EMPTY_PLAN

function updatePlan($: EngineInterface, change: (value: Plan) => Plan): void {
  current = change(current)
  $.ui.invalidate('ui.render')
}

function withSteps(change: (steps: readonly Step[]) => Step[]): (value: Plan) => Plan {
  return value => ({ ...value, steps: change(value.steps) })
}

export const register: Register = on => {
  // Each hook only watches: it lets the tool run, then copies what changed. If it fails, the call goes on untouched.
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const answer = await next(e)

    // A subagent's TodoWrite is its own private list, not the session's plan.
    if (answer.deny === undefined && !answer.isError && e.agentId === undefined) {
      updatePlan($, withSteps(() => fromTodos(answer.result.newTodos)))
    }

    return answer
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const answer = await next(e)

    if (answer.deny === undefined && !answer.isError) {
      const created: Step = {
        id: answer.result.task.id,
        title: e.subject,
        activeTitle: e.activeForm ?? null,
        status: 'pending',
      }
      updatePlan($, withSteps(steps => upsertStep(steps, created)))
    }

    return answer
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const answer = await next(e)

    if (answer.deny === undefined && !answer.isError && answer.result.success) {
      updatePlan(
        $,
        withSteps(steps => changeStep(steps, e.taskId, { title: e.subject, activeTitle: e.activeForm, status: e.status })),
      )
    }

    return answer
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskList' }, async ($, e, next) => {
    const answer = await next(e)

    if (answer.deny === undefined && !answer.isError) {
      updatePlan($, withSteps(steps => fromTaskList(answer.result.tasks, steps)))
    }

    return answer
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskGet' }, async ($, e, next) => {
    const answer = await next(e)
    const task = answer.deny === undefined && !answer.isError ? answer.result.task : null

    if (task) {
      updatePlan($, withSteps(steps => changeStep(steps, task.id, { title: task.subject, status: task.status })))
    }

    return answer
  }).catch(($, e, next) => next(e))

  // A finished plan stays on screen until the person sends the next prompt.
  on('prompt.submit', async ($, e, next) => {
    updatePlan($, value =>
      progressOf(value.steps).isComplete ? { ...value, hiddenAt: signature(value.steps) } : value,
    )

    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      updatePlan($, () => EMPTY_PLAN)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !isShown(current)) {
      return next(e)
    }

    const progress = progressOf(current.steps)
    const label = barLabel(progress)
    const hide = () => updatePlan($, value => ({ ...value, hiddenAt: signature(value.steps) }))

    if (e.surface === 'desktop') {
      const { Box, Button, Svg, Text } = $.ui.resolve(e)

      return (
        <Box key="task-progress" flexDirection="row" alignItems="center" gap={1}>
          <Svg source={svgBar(progress, 160, 8)} alt={label} width={160} height={8} />
          <Text bold>
            {label}
          </Text>
          {progress.current === null ? null : (
            <Text dimColor wrap="truncate-end">
              {progress.current}
            </Text>
          )}
          <Button key="hide" plain label="Hide" onPress={hide} />
        </Box>
      )
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const width = Math.max(10, Math.min(30, Math.floor(e.props.bodyColumns / 4)))
    const filled = filledCells(progress, width)

    return (
      <Box key="task-progress" flexDirection="row" gap={1}>
        <Text>
          <Text color={progress.isComplete ? 'success' : 'claude'}>{'█'.repeat(filled)}</Text>
          <Text dimColor>{'░'.repeat(width - filled)}</Text>
        </Text>
        <Text bold>
          {label}
        </Text>
        {progress.current === null ? null : (
          <Text dimColor wrap="truncate-end">
            {progress.current}
          </Text>
        )}
        <Button key="hide" plain label="hide" onPress={hide} />
      </Box>
    )
  })
}
