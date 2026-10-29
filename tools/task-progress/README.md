# 📊 Task progress bar

A live progress bar above the prompt box for Claude's checklist: how many steps are done, and which one is running now.

<img src="../../docs/images/progress-bar-terminal.png" alt="The progress bar in a terminal session: an orange bar, 3 of 5 done, Running tests, hide" width="720">

<img src="../../docs/images/progress-bar-desktop.png" alt="The progress bar in the Claude desktop app: a rounded orange bar, 3 of 5 done, Running tests, Hide" width="640">

> Pictures rendered from the add-on's real output, with a demo checklist.

## Why you want it

- **Long jobs stop being a black box.** When Claude splits work into steps, you see `3 of 5 done` and the step it is on, without scrolling back through the chat.
- **You know when it is finished.** The bar turns green with `All 5 done`, and goes away when you send your next message.
- **It stays out of the way.** No checklist, no bar. Press **hide** and it waits until the checklist changes.

## How it works

- Claude keeps a checklist with its task tools (`TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`, or the older `TodoWrite`). In the desktop app, Claude uses the app's own plan tool instead (`update_plan`, and `wrap_up` when the work is done). The add-on watches those calls and counts the steps. It never changes them.
- It draws in the band right above the prompt box: block characters in the terminal, a rounded bar in the desktop app.
- **One setting matters.** On newer models (for example Opus 5.5), Claude's checklist tools are off by default, so there would be nothing to count. The installer turns them on with `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` in `~/.claude/settings.json`. With the tools on, Claude keeps checklists on all models, which uses a little more of each chat's context.
- A checklist made by a helper agent (a subagent) is that agent's own and is not counted.

## Install

From a clone of this repository (see the [main README](../../README.md#-install)):

```bash
~/.claude-tools/tools/task-progress/install.sh
```

Or with no download at all:

```bash
claude plugin marketplace add SouravAggarwal/Claude-Tools
```

```bash
claude plugin install task-progress@claude-tools --scope user
```

```bash
jq '.env.CLAUDE_CODE_ENABLE_TODO_TOOLS = "1"' ~/.claude/settings.json > /tmp/claude-settings.json && mv /tmp/claude-settings.json ~/.claude/settings.json
```

Then start a new chat. Or ask your AI agent: *"Install the task progress bar from https://github.com/SouravAggarwal/Claude-Tools"* (it follows [AGENT.md](AGENT.md)).

## Use

Nothing to do: ask Claude for something with several steps, and the bar appears.

| You see | It means |
| --- | --- |
| `███████░░░░ 3 of 5 done  Running tests` | 3 steps done; Claude is on "Running tests" now |
| `██████████ All 5 done` (green) | Finished; it goes away when you send your next message |
| nothing | No checklist yet, or you pressed **hide** |

## Remove

```bash
~/.claude-tools/tools/task-progress/uninstall.sh
```

This also turns Claude's checklist tools back off. To keep them on, add `--keep-checklists`.

By hand:

```bash
claude plugin uninstall task-progress@claude-tools
```

## Update or reload

```bash
git -C ~/.claude-tools pull
```

Then type `/reload-plugins` in an open chat, or start a new one.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| The bar never shows | Check the setting: `jq .env.CLAUDE_CODE_ENABLE_TODO_TOOLS ~/.claude/settings.json` should print `"1"`. Start a **new** chat after changing it. Ask for a job with several steps. |
| Still nothing | Run `claude -p "hi" --debug-file /tmp/claude-debug.log`, then `grep task-progress /tmp/claude-debug.log`. If it says the add-on is "not loaded: the rollout flag ... is off", update Claude Code (`claude update`). Add-ons need 2.1.278 or later. |
| The bar shows an old, finished plan | Send any message (a finished plan hides itself then), or press **hide**. |

## Files

| File | What it is |
| --- | --- |
| `hooks/register.tsx` | Watches the task tools and draws the bar |
| `hooks/plan.ts` | Counts the steps |
| `hooks/bar.ts` | The bar's text and picture |
| `tests/` | 24 tests, run with `claude plugin test tools/task-progress` |
| `install.sh`, `uninstall.sh` | Add and remove it |
