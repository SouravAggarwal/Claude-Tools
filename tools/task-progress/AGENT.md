# Agent guide: install the task progress bar

You are installing a Claude Code add-on that draws a progress bar above the prompt. Follow these steps in order. Each command is safe to run more than once.

## 1. Check what is needed

```bash
claude --version
```

It must be 2.1.278 or later. If it is older, run `claude update` first.

```bash
jq --version
```

If `jq` is missing, tell the person how to install it (macOS: `brew install jq`) and stop.

## 2. Get the repository

If `~/.claude-tools/.git` exists, update it:

```bash
git -C ~/.claude-tools pull
```

Otherwise clone it:

```bash
git clone https://github.com/SouravAggarwal/Claude-Tools ~/.claude-tools
```

## 3. Install

```bash
~/.claude-tools/tools/task-progress/install.sh
```

It turns on Claude's checklist tools (`CLAUDE_CODE_ENABLE_TODO_TOOLS=1` in `~/.claude/settings.json`) and installs the add-on for every project. If your own safety rules stop you from changing the person's settings, show them this command and let them run it.

## 4. Check that it worked

```bash
claude plugin list
```

`task-progress@claude-tools` must show as enabled.

```bash
jq .env.CLAUDE_CODE_ENABLE_TODO_TOOLS ~/.claude/settings.json
```

It must print `"1"`.

## 5. Tell the person

- The bar appears in **new** chats (or in an open chat after `/reload-plugins`) whenever Claude works through a checklist.
- What changed: the add-on is installed, and Claude's checklist tools are on. That uses a little more of each chat's context.
- How to remove it: `~/.claude-tools/tools/task-progress/uninstall.sh`

## Uninstall (only when asked)

```bash
~/.claude-tools/tools/task-progress/uninstall.sh
```

Add `--keep-checklists` if the person wants to keep Claude's checklist tools on.

## If something fails

| Symptom | What to do |
| --- | --- |
| `claude plugin install` says the marketplace is missing | Run `claude plugin marketplace add ~/.claude-tools`, then step 3 again. |
| The bar does not show in a new chat | Check step 4. Then run `claude -p "hi" --debug-file /tmp/claude-debug.log` and `grep task-progress /tmp/claude-debug.log`. "rollout flag ... is off" means Claude Code is too old: `claude update`. |
