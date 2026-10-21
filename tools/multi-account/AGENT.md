# Agent guide: set up multi-account

You are installing commands and an add-on that let a person use several Claude accounts from one desktop chat. Follow these steps in order. Each command is safe to run more than once.

**Never type a password or sign-in code.** When an account must sign in, start the sign-in and let the person finish it in their browser.

## 1. Check what is needed

```bash
claude --version
```

It must be 2.1.278 or later. If it is older, run `claude update` first.

```bash
jq --version && python3 --version
```

If either is missing, tell the person how to install it (macOS: `brew install jq`; `xcode-select --install` for python3) and stop.

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
~/.claude-tools/tools/multi-account/install.sh
```

It writes a rule that new desktop chats load at start, and adds a start-up hook to `~/.claude/settings.json`. If your safety rules stop you from writing either, show the person this command and let them run it.

## 4. Ask the person about their accounts

Ask, in one message:

1. Which accounts do you want to use? Give a short name (tag) and a label (for example the email) for each.
2. Which one is the Claude desktop app signed in to?
3. Which one should do the work first?

## 5. Add each account

The one the desktop app uses gets `--desktop`:

```bash
claude-accounts-add claude-a "you@example.com" --desktop
```

Every other account:

```bash
claude-accounts-add claude-b "other@example.com"
```

## 6. Sign each account in

For each account, start its sign-in where the person can see it and finish it (a terminal they can type in). Use the line `claude-accounts-add` printed:

```bash
CLAUDE_CONFIG_DIR=~/.claude-accounts/homes/claude-b claude auth login
```

Wait until the person says they are done.

## 7. Pick the active account and check

```bash
claude-use claude-b
```

```bash
claude-use
```

Every account should show, and the chosen one should be marked `★ active`. Then make one test call in any folder:

```bash
claude-ask ~ "Reply with only: OK"
```

It must print `OK` and a line like `[claude-b · other · chat …]`.

## 8. Tell the person

- Start a **new** desktop chat and ask as usual. Say "use claude-a" to switch, "limits" to see use.
- Watch all accounts with `claude-accounts`, or type `/accounts` in the app.
- What changed: commands in `~/.local/bin`, settings in `~/.claude-accounts/`, a start-up hook in `~/.claude/settings.json`, and the `account-status` add-on.
- How to remove it: `~/.claude-tools/tools/multi-account/uninstall.sh`

## Uninstall (only when asked)

```bash
~/.claude-tools/tools/multi-account/uninstall.sh
```

It keeps `~/.claude-accounts` (accounts, chats). Delete that only if the person asks.

## If something fails

| Symptom | What to do |
| --- | --- |
| `command not found: claude-use` | `~/.local/bin` is not on PATH. Tell the person to add it to their shell profile, or call `~/.local/bin/claude-use` directly. |
| `claude-use` says "not signed in" | Repeat step 6 for that account. |
| `claude-ask` prints `ERROR` about sign-in | The account's sign-in expired: repeat step 6. |
| The add-on does not load for an account | `claude update`, then run `claude-accounts-add --sync`. |
