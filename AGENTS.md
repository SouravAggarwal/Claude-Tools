# AGENTS.md

Rules for AI agents (Claude Code, Codex and others) working with this repository. `CLAUDE.md` imports this file, so both read the same rules.

This is a **public** repository of small, generic add-ons and commands for Claude Code. Anyone may install from it, so everything here must work for anyone and must never contain one person's data.

---

## If you were asked to install a tool for someone

1. Find the tool in the table in [`README.md`](README.md).
2. Read that tool's `tools/<tool>/AGENT.md` and follow its steps in order. It says what to check, what to run, how to check that it worked, and what to hand back to the person.
3. Never type a password, sign-in code or token for the person. When a step needs a sign-in, start it, then let the person finish it.
4. When you are done, tell the person in a few short points what changed on their computer and how to remove it.

## Layout

| Path | What it holds |
| --- | --- |
| `README.md` | The front page: what each tool is, when you need it, pictures, install. |
| `AGENTS.md` | These rules. `CLAUDE.md` only imports it. |
| `.claude-plugin/marketplace.json` | The add-on list Claude Code installs from (`<add-on>@claude-tools`). |
| `docs/images/` | Pictures used by the READMEs. |
| `tools/<tool>/` | One folder per tool: everything the tool needs and nothing else. |

## Every tool folder has

| File | Purpose |
| --- | --- |
| `README.md` | For people: what it does, why or when you need it, how it works, a picture, install, use, every command, remove, update, troubleshooting. |
| `AGENT.md` | For agents: exact, copy-paste steps to check, install, verify, uninstall, and what to hand back to the person. |
| `install.sh` | Installs the tool. Safe to run twice. Asks nothing. Touches only what the tool owns. Ends by printing what is next. |
| `uninstall.sh` | Removes what `install.sh` added. Never deletes the person's own data (chats, accounts, notes); it prints how to remove those instead. |
| An add-on folder, if any | `.claude-plugin/plugin.json`, `hooks/`, `tests/`. Listed in `.claude-plugin/marketplace.json`. |
| `bin/`, if any | Commands. `install.sh` links them into `~/.local/bin`, so `git pull` updates them. |

## Adding a new tool

1. Make `tools/<tool-name>/` (lower case, words joined by `-`).
2. Write the code, `install.sh` and `uninstall.sh`, then `README.md` and `AGENT.md`, in the same shape as the existing tools.
3. If it has an add-on, add it to `.claude-plugin/marketplace.json`, with `"source": "./tools/<tool-name>/<add-on folder>"`, and set `author`, `license` and `homepage` in its `plugin.json`.
4. Add a row to the tools table in the root `README.md`: what it does, when you want it, and a picture in the **Looks like** column if it shows anything on screen.
5. Run every check below.

## Changing a tool

- Raise `version` in its `plugin.json` when an add-on changes.
- Keep its `README.md` and `AGENT.md` true. If a command, a path or a step changes, both change in the same commit.

## Checks before every commit

```bash
claude plugin validate tools/<tool>/<add-on folder>
```

```bash
claude plugin test tools/<tool>/<add-on folder>
```

Then run the tool's `install.sh`, use it, and run `uninstall.sh`, all in a throwaway home folder, so nothing on your own computer changes:

```bash
env -i HOME="$(mktemp -d)" PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" TERM=xterm bash tools/<tool>/install.sh
```

## Rules for everything in this repository

- **No personal data.** No real email addresses, names, company or project names, home folder paths (`/Users/<name>`, `/home/<name>`), tokens or keys. Use `~` or `$HOME`, and `example.com` for examples. Check with `git grep -n -i -E "@gmail|/Users/|/home/[a-z]|token|secret"` before committing.
- **Simple words.** Write for someone who has never seen the tool. Short key points, not long paragraphs. Explain any term the first time you use it.
- **Generic.** Never hard-code one person's accounts, folders or settings. Read them from the person's own config (for example `~/.claude-accounts/config.json`).
- **Honest docs.** Say what was tested and on what. Do not claim a platform or a version you did not try.
- **Safe scripts.** `set -euo pipefail`; check that each needed command exists; no `sudo`; never remove anything outside what the tool installed; never print a token.
- **Pictures** come from the tool's real output with demo data, and say so.

## Writing add-ons (Claude Code "mods")

These rules come from making the existing add-ons load on older and newer Claude Code versions alike:

- Keep drawing state in module variables and call `$.ui.invalidate('ui.render')` after a change. Older versions have no `$.state`.
- Any helper that receives `$` must be a top-level function in the same file. Do not pass `$` to imported helpers such as `update`.
- In `Text`, use `bold`, not `weight` or `tabular`.
- Hooks on `tool.call` and `prompt.submit` only watch: call `next(e)` and add `.catch(($, e, next) => next(e))`, so a failure never blocks the person's work.
- In tests, a `Text` element loses its `key`: find text by its words. A test's `on` hooks that answer an engine call return `{ value }`. Run each drawing test on both `terminal` and `desktop`.
