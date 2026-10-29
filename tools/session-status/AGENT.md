# Agent guide: install session-status

You are installing a Claude Code add-on that shows each session's state (working, needs you, done, failed) as a marker in the desktop app's sidebar and on a `/sessions` board. Follow these steps in order. Each command is safe to run more than once.

## 1. Check what is needed

```bash
claude --version
```

It must be 2.1.278 or later. If it is older, run `claude update` first.

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
~/.claude-tools/tools/session-status/install.sh
```

It installs the add-on for every project. The only setting it writes is the markers option (`A`), and only when none is stored yet. If your own safety rules stop you from installing add-ons for the person, show them this command and let them run it.

## 4. Check that it worked

```bash
claude plugin list
```

`session-status@claude-tools` must show as enabled.

## 5. Tell the person

- It works in **new** chats (or in an open chat after `/reload-plugins`).
- In the desktop app, each chat's sidebar title gets a marker: ⏳ working, 💬 needs you, ✅ done, ⚠️ failed, and a step count such as `4/7`.
- `/sessions` opens the board of every session. Clicking a title opens that chat.
- It never alerts or notifies.
- Markers can be changed (sets `A`, `B`, `C`) or turned `off` in `/config`.
- What changed: the add-on is installed. Each session writes a small file to `~/.claude-session-status/`.
- How to remove it: `~/.claude-tools/tools/session-status/uninstall.sh`

## Uninstall (only when asked)

```bash
~/.claude-tools/tools/session-status/uninstall.sh
```

It leaves `~/.claude-session-status/` in place and prints how to delete it. Only delete it if the person asks.

## If something fails

| Symptom | What to do |
| --- | --- |
| `claude plugin install` says the marketplace is missing | Run `claude plugin marketplace add ~/.claude-tools`, then step 3 again. |
| The person sees an approval card on every rename | That chat has a title they gave it themselves (not tested yet). Offer to turn markers off: `claude plugin install session-status@claude-tools --scope user --config markers=off`, or `off` in `/config`. |
| No marker in the sidebar | Markers only appear in the desktop app, and only after the app has named the chat. Check the **Sidebar markers** option is not `off`. |
| Nothing shows at all | Run `claude -p "hi" --debug-file /tmp/claude-debug.log` and `grep session-status /tmp/claude-debug.log`. "rollout flag ... is off" means Claude Code is too old: `claude update`. |
