# 🔀 Multi-account

Talk in one Claude desktop chat while the work runs on whichever of your Claude accounts is active. Switch accounts any time and the chat carries on with nothing lost. Watch every account's limits live.

<img src="../../docs/images/accounts-dashboard.png" alt="The claude-accounts dashboard: two accounts with 5-hour and weekly limit bars, the active one marked, and each chat's project, context and current work" width="760">

> Picture rendered from the `claude-accounts` command's real output, with demo accounts.

## Why you want it

- **Small limits, many accounts.** When one account nears its 5-hour or weekly limit, switch to another and keep going in the same conversation.
- **One place to talk.** You never juggle windows or sign-ins. You keep typing in the desktop app.
- **No surprises.** A live view shows each account's 5-hour and weekly use, when each resets, and what every chat is doing right now.

## How it works

```text
 You ──▶ desktop app chat (the "front desk")
                │  hands each project request to
                ▼
           claude-ask ──▶ the ACTIVE account (set with claude-use)
                │            runs Claude in the background, in your project folder
                ▼
   ~/.claude-accounts/shared/   ← ONE chat history that every account reads and writes
```

- **The front desk.** When a desktop chat starts, it loads a short rule (`~/.claude-accounts/front-desk-rule.md`): "hand project work to `claude-ask` and report back". Work that needs the app's own connections (Slack, Google, the browser) stays in the desktop chat.
- **The workers.** Each account gets its own Claude folder (`~/.claude-accounts/homes/<tag>`), so each keeps its own sign-in. `claude-ask` runs Claude in that folder for the active account.
- **Nothing lost on a switch.** Every worker's chat history points at the same shared folder, and each project folder keeps one chat. After `claude-use other-account`, the next message picks up the same chat on the new account. It re-reads the whole chat once, which costs that account a little more.
- **Live limits.** The `account-status` add-on runs inside every chat of every account. Every 20 seconds, and at each step, it records the account, its 5-hour and weekly use, the chat's context window and its current work in `~/.claude-accounts/status/`. `claude-accounts` and the `/accounts` panel read those records.
- **Safety.** Workers run in auto mode: a checker lets safe commands run and blocks risky ones, the same as a normal chat. Before starting a worker, `claude-ask` removes the calling chat's own account details from its environment, so a worker only ever uses its own sign-in.

## Install

From a clone of this repository (see the [main README](../../README.md#-install)):

```bash
~/.claude-tools/tools/multi-account/install.sh
```

It links five commands into `~/.local/bin`, creates `~/.claude-accounts/`, adds the front-desk rule to new desktop chats, and installs the `account-status` add-on.

Or ask your AI agent: *"Set up multi-account from https://github.com/SouravAggarwal/Claude-Tools"* (it follows [AGENT.md](AGENT.md)).

## Set up your accounts

**1.** Add the account the desktop app is signed in to (`--desktop`):

```bash
claude-accounts-add claude-a "you@example.com" --desktop
```

**2.** Add each other account:

```bash
claude-accounts-add claude-b "other@example.com"
```

**3.** Sign each one in, using the line each command printed:

```bash
CLAUDE_CONFIG_DIR=~/.claude-accounts/homes/claude-b claude auth login
```

**4.** Pick the account that does the work:

```bash
claude-use claude-b
```

**5.** Start a **new** desktop chat and ask as usual.

## Daily use

In the desktop chat, just ask for what you need. These phrases also work:

| Say | It runs |
| --- | --- |
| "use claude-a" | `claude-use claude-a` |
| "use the best one" | `claude-use --best` (the signed-in account with the most room) |
| "limits" | `claude-use` |
| "here: …" | does it in the desktop chat itself |

## Commands

| Command | What it does |
| --- | --- |
| `claude-use` | Lists accounts: active one, 5-hour and weekly use. |
| `claude-use TAG` | Makes TAG the active account (checks it is signed in first). |
| `claude-use --best` | Makes the signed-in account with the most room left the active one. |
| `claude-ask FOLDER "message"` | Sends a message to the active account, working in FOLDER, and prints the reply. Same folder, same chat. |
| `claude-ask --new FOLDER "message"` | Starts that folder's chat over. |
| `claude-ask --account TAG FOLDER "message"` | Uses TAG for this one message. |
| `claude-ask --which FOLDER` | Prints which account a message would go to, and the project name. |
| `claude-accounts` | Live view of all accounts and chats. `--once` prints it one time. |
| `claude-accounts-add TAG "LABEL" [--desktop]` | Sets up an account (folder, shared history, add-ons, settings). |
| `claude-accounts-add --sync` | Copies the desktop app's start-up hooks and settings to every worker again. |
| `claude-as TAG` | Opens an interactive Claude chat in the terminal as TAG. |
| `/accounts` (in the app) | The same live view as `claude-accounts`, as a panel. |

## The config file

`~/.claude-accounts/config.json` holds your accounts. The commands write it; you can also edit it:

```json
{
  "active": "claude-b",
  "accounts": {
    "claude-a": { "label": "you@example.com", "configDir": "~/.claude-accounts/homes/claude-a",
                  "desktopApp": true, "desktopConfigDir": "~/.claude", "worker": true, "permissionMode": "auto" },
    "claude-b": { "label": "other@example.com", "configDir": "~/.claude-accounts/homes/claude-b",
                  "worker": true, "permissionMode": "auto" }
  },
  "projects": { "web-app": { "folders": ["~/code/web-app"] } }
}
```

`projects` is optional. It only gives folders a friendly name in the live view.

## Where things are saved

| What | Where |
| --- | --- |
| Commands | `~/.local/bin/` (links into this folder) |
| Account list | `~/.claude-accounts/config.json` |
| Front-desk rule | `~/.claude-accounts/front-desk-rule.md` |
| Each account's own Claude folder | `~/.claude-accounts/homes/<tag>/` |
| Shared chat history | `~/.claude-accounts/shared/` |
| Which chat each folder uses | `~/.claude-accounts/chats/` |
| Live status | `~/.claude-accounts/status/` (cleared after 3 days) |
| Sign-ins | your system's credential store (macOS keychain) |

## Remove

```bash
~/.claude-tools/tools/multi-account/uninstall.sh
```

It removes the commands, the front-desk rule hook and the add-on. It keeps `~/.claude-accounts` (your accounts and chats) and prints how to delete it too.

To remove one account: delete it from `config.json`, then sign it out:

```bash
CLAUDE_CONFIG_DIR=~/.claude-accounts/homes/claude-b claude auth logout
```

## Update or reload

```bash
git -C ~/.claude-tools pull
```

The commands update at once. For the add-on, type `/reload-plugins` in an open chat. For a changed front-desk rule, start a new desktop chat.

## Good to know

- **The front desk uses a little of the desktop app's account** for every message. If that account runs out, the app stops too. Sign the app in to another account, then run `claude-accounts-add <that tag> "<label>" --desktop`.
- **Keep front-desk chats short** and start new ones often. The real conversation lives in the worker's chat, so nothing is lost.
- **The desktop app's own history is not shared.** Workers share their history with each other, not with the app's chats.
- **Workers cannot ask you to approve things.** They run in the background in auto mode. To change that, set `permissionMode` for an account in `config.json` (for example `acceptEdits` only allows file edits).

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `claude-use` says "not signed in" | Run the sign-in line: `CLAUDE_CONFIG_DIR=~/.claude-accounts/homes/<tag> claude auth login` |
| The live view shows no limits | Limits appear after that account's next message. |
| Add-ons do not load for one account | Update Claude Code: `claude update`. Old versions can keep a stale "add-ons off" switch. |
| The desktop chat does the work itself instead of handing it over | The rule loads only in **new** desktop chats. Check `~/.claude-accounts/front-desk-rule.md` exists. |
| Your AI agent refuses to write the front-desk rule | Some agents' safety checks guard files that steer future chats. Run `install.sh` yourself. |
| `claude-ask: no active account yet` | Add an account with `claude-accounts-add`, then `claude-use <tag>`. |

## Files

| File | What it is |
| --- | --- |
| `bin/claude-use`, `bin/claude-ask`, `bin/claude-accounts`, `bin/claude-accounts-add`, `bin/claude-as` | The commands (Python 3) |
| `account-status/` | The add-on behind the live view and `/accounts` (9 tests: `claude plugin test tools/multi-account/account-status`) |
| `templates/config.json`, `templates/front-desk-rule.md` | What `install.sh` copies on first install |
| `install.sh`, `uninstall.sh` | Add and remove it |
