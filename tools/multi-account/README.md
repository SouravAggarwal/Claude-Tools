# 🔀 Multi-account

Talk in one Claude desktop chat while the work runs on a second Claude account of yours. Swap the two whenever one runs low, and the chat carries on with nothing lost. Watch every account's limits live.

<img src="../../docs/images/accounts-dashboard.png" alt="The claude-accounts live view: a primary and a secondary account with 5-hour and weekly limit bars, the one doing the work marked, and each chat's project, context and current work" width="760">

> Picture rendered from the `claude-accounts` command's real output, with demo accounts.

## Why you want it

- **Small limits, two accounts.** Let one account do the heavy work while the other only runs the desktop app. When one runs low, swap them and keep going in the same conversation.
- **One place to talk.** You never juggle windows or sign-ins. You keep typing in the desktop app.
- **No surprises.** A live view shows each account's 5-hour and weekly use, when each resets, and what every chat is doing right now.

## The two roles

| Role | What it is | Set it with |
| --- | --- | --- |
| **Primary** | The account the Claude desktop app is signed in to. Every desktop chat runs on it. | `claude-use --primary TAG` |
| **Secondary** | Optional. When set, it does **all** the work, for every prompt and every project. | `claude-use --secondary TAG` |

That gives two modes:

| Mode | Config | What happens |
| --- | --- | --- |
| **One account** | `"secondary": null` | The desktop chat does every task itself, on the primary. No other account is ever used, and nothing is handed on. |
| **Two accounts** | `"secondary": "claude-b"` | The desktop chat hands every project task to the secondary and reports back. The primary only spends a little to pass tasks on. |

**Never spent twice.** If the secondary is the same account the desktop app is signed in to (say you signed the app in to it and forgot to swap), the commands notice and the desktop chat does the work itself. The app tells its chats which account it is signed in to, so this check does not depend on the config being right.

**Always on the primary, in both modes:** work that needs the desktop app's own connections (Slack, Jira, Google, Chrome, the browser pane), questions about this setup, and any message you start with `here:`.

## Configure it by asking

In any new desktop chat, just say what you want. The chat runs the command for you:

| Say | It runs | Result |
| --- | --- | --- |
| "make claude-b the secondary" or "use claude-b" | `claude-use --secondary claude-b` | claude-b does all the work |
| "turn off the secondary" or "use only the primary" | `claude-use --secondary off` | the desktop chat does everything itself |
| "make claude-b the primary" | `claude-use --primary claude-b` | then sign the app in to claude-b |
| "swap primary and secondary" | `claude-use --swap` | then sign the app in to the new primary |
| "use the best one" | `claude-use --best` | the account with the most room left becomes the secondary |
| "show my accounts" or "limits" | `claude-use` | roles, 5-hour and weekly use, who does the work |
| "here: fix the login test" | (no command) | just this task runs on the primary |

## Or configure it by hand

Everything lives in `~/.claude-accounts/config.json`. Edit it with any editor; the next message uses it.

**One account** (the app's account does everything):

```json
{
  "primary": "claude-a",
  "secondary": null,
  "accounts": {
    "claude-a": { "email": "you@example.com", "configDir": "~/.claude-accounts/homes/claude-a", "permissionMode": "auto" }
  },
  "projects": {}
}
```

**Two accounts** (claude-b does all the work):

```json
{
  "primary": "claude-a",
  "secondary": "claude-b",
  "accounts": {
    "claude-a": { "email": "you@example.com", "configDir": "~/.claude-accounts/homes/claude-a", "permissionMode": "auto" },
    "claude-b": { "email": "other@example.com", "configDir": "~/.claude-accounts/homes/claude-b", "permissionMode": "auto" }
  },
  "projects": { "web-app": { "folders": ["~/code/web-app"] } }
}
```

| Field | Meaning |
| --- | --- |
| `primary` | The tag of the account the desktop app is signed in to. |
| `secondary` | The tag of the account that does all the work, or `null` for none. |
| `accounts.<tag>.email` | The email that account signs in with. Used to spot when the app's account and the secondary are the same. |
| `accounts.<tag>.configDir` | That account's own Claude folder, where its sign-in lives. |
| `accounts.<tag>.permissionMode` | How the secondary runs commands with no one to ask: `auto` (a checker lets safe commands run and blocks risky ones) or `acceptEdits` (file edits only). |
| `projects` | Optional. Friendly names for folders in the live view. |

## How it works

```text
 You ──▶ desktop app chat, on the PRIMARY
             │
             ├─ no secondary ──────────▶ does the task itself
             │
             └─ secondary set ─▶ claude-ask ──▶ the SECONDARY runs Claude in your project folder
                                                    │
                                   ~/.claude-accounts/shared/  ← one chat history every account shares
```

- **The front desk.** When a desktop chat starts, it loads a short rule (`~/.claude-accounts/front-desk-rule.md`). It runs `claude-use --who`, which prints `here` or the secondary's tag, and then either works itself or hands each project task to `claude-ask`.
- **Each account's own folder.** Every account gets `~/.claude-accounts/homes/<tag>`, so each keeps its own sign-in. `claude-ask` runs Claude in that folder.
- **Nothing lost on a swap.** Every account's chat history points at the same shared folder, and each project folder keeps one chat. After a swap, the next message picks up the same chat on the new account. It re-reads the whole chat once, which costs that account a little more.
- **Live limits.** The `account-status` add-on runs inside every chat of every account. Every 20 seconds, and at each step, it records the account, its 5-hour and weekly use, the chat's context window and its current work in `~/.claude-accounts/status/`. `claude-accounts` and the `/accounts` panel read those records.
- **Safety.** Before starting the secondary, `claude-ask` removes the calling chat's own account details from its environment, so the secondary only ever uses its own sign-in.

## Install

From a clone of this repository (see the [main README](../../README.md#-install)):

```bash
~/.claude-tools/tools/multi-account/install.sh
```

It links five commands into `~/.local/bin`, creates `~/.claude-accounts/`, adds the front-desk rule to new desktop chats, and installs the `account-status` add-on.

Or ask your AI agent: *"Set up multi-account from https://github.com/SouravAggarwal/Claude-Tools"* (it follows [AGENT.md](AGENT.md)).

## Set up your accounts

**1.** Add the account the desktop app is signed in to, as the primary:

```bash
claude-accounts-add claude-a you@example.com --primary
```

That's all you need for **one-account mode**. Start a new desktop chat and work as usual.

**2.** For **two-account mode**, add the second account:

```bash
claude-accounts-add claude-b other@example.com
```

**3.** Sign it in, with the line the command printed:

```bash
CLAUDE_CONFIG_DIR=~/.claude-accounts/homes/claude-b claude auth login
```

**4.** Make it the secondary (or say "make claude-b the secondary" in a desktop chat):

```bash
claude-use --secondary claude-b
```

**5.** Start a **new** desktop chat and ask as usual.

## When the primary runs out

The desktop app needs its own account to answer at all. When the primary hits its limit:

1. Sign the desktop app in to the secondary's account.
2. In a new chat, say "swap primary and secondary". The old primary now does the work, if it has room. Or say "turn off the secondary" to let the new primary do everything.

## Commands

| Command | What it does |
| --- | --- |
| `claude-use` | Lists accounts: roles, 5-hour and weekly use, and who does the work. |
| `claude-use --secondary TAG` | TAG does all the work (it must be signed in). `claude-use TAG` is the same. |
| `claude-use --secondary off` | No secondary: the desktop chat does everything itself. |
| `claude-use --primary TAG` | TAG is the account the desktop app is signed in to. |
| `claude-use --swap` | Primary and secondary trade places. |
| `claude-use --best` | The signed-in non-primary account with the most room becomes the secondary. |
| `claude-use --who` | Prints who does the work for a desktop chat: `here` or the secondary's tag. |
| `claude-ask FOLDER "message"` | Sends a message to the secondary, working in FOLDER, and prints the reply. Same folder, same chat. In a desktop chat with no secondary, it says to do the task there. |
| `claude-ask --new FOLDER "message"` | Starts that folder's chat over. |
| `claude-ask --account TAG FOLDER "message"` | Uses TAG for this one message. |
| `claude-accounts` | Live view of all accounts and chats. `--once` prints it one time. |
| `claude-accounts-add TAG EMAIL [--primary \| --secondary]` | Sets up an account: its folder, the shared history, add-ons and settings. The first one becomes the primary. |
| `claude-accounts-add --sync` | Copies the desktop app's start-up hooks and settings to every account again. |
| `claude-as [TAG]` | Opens a terminal chat as TAG, or as the account that does the work. Use it instead of `claude`. |
| `/accounts` (in the app) | The same live view as `claude-accounts`, as a panel. |

## Where things are saved

| What | Where |
| --- | --- |
| Commands | `~/.local/bin/` (links into this folder) |
| Roles and accounts | `~/.claude-accounts/config.json` |
| Front-desk rule | `~/.claude-accounts/front-desk-rule.md` |
| Each account's own Claude folder | `~/.claude-accounts/homes/<tag>/` |
| Shared chat history | `~/.claude-accounts/shared/` |
| Which chat each folder uses | `~/.claude-accounts/chats/` |
| Live status | `~/.claude-accounts/status/` (old ones are cleared after 3 days) |
| Sign-ins | your system's credential store (macOS keychain) |

## Remove

```bash
~/.claude-tools/tools/multi-account/uninstall.sh
```

It removes the commands, the front-desk rule hook and the add-on. It keeps `~/.claude-accounts` (your accounts and chats) and prints how to delete it too.

## Update

```bash
git -C ~/.claude-tools pull
```

The commands update at once. For the add-on, type `/reload-plugins` in an open chat. To take a newer front-desk rule, run `~/.claude-tools/tools/multi-account/install.sh --refresh-rule`, then start a new desktop chat. Configs from version 1.0 (`"active"`) are read as primary and secondary on their own.

## Good to know

- **One chat per folder.** Tasks in the same project folder share one chat, so run them one after another. Tasks in different folders can run at the same time.
- **Keep desktop chats short** in two-account mode, and start new ones often. The real conversation lives in the secondary's chat, so nothing is lost.
- **The desktop app's own history is not shared.** The accounts share their history with each other, not with the app's chats.
- **The secondary cannot ask you to approve things.** It runs in the background, in auto mode by default. Change `permissionMode` in the config to change that.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `claude-use` says "not signed in" | Run the sign-in line: `CLAUDE_CONFIG_DIR=~/.claude-accounts/homes/<tag> claude auth login` |
| `claude-use` says "this app is signed in to … but the primary is …" | You switched the app's account. Run the command it suggests, or say "make <tag> the primary". |
| The live view shows no limits | Limits appear after that account's next message. |
| The desktop chat does the work itself in two-account mode | The rule loads only in **new** desktop chats. Also check `claude-use --who` does not print `here`. |
| Add-ons do not load for one account | Update Claude Code: `claude update`. Old versions can keep a stale "add-ons off" switch. |
| Your AI agent refuses to write the front-desk rule | Some agents' safety checks guard files that steer future chats. Run `install.sh` yourself. |

## Files

| File | What it is |
| --- | --- |
| `bin/claude-use`, `bin/claude-ask`, `bin/claude-accounts`, `bin/claude-accounts-add`, `bin/claude-as` | The commands (Python 3) |
| `bin/claude_accounts_lib.py` | What the commands share: the config, the two roles, the same-account check |
| `account-status/` | The add-on behind the live view and `/accounts` (11 tests: `claude plugin test tools/multi-account/account-status`) |
| `templates/config.json`, `templates/front-desk-rule.md` | What `install.sh` copies on first install |
| `install.sh`, `uninstall.sh` | Add and remove it |
