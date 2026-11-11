# Privacy policy

This policy covers every add-on in this repository: Task Progress Bar, Session Status Markers, Usage Limits Monitor and Sidebar Folders.

## In short

- The add-ons collect nothing about you and send nothing anywhere.
- They make no network requests, have no servers, and use no analytics or tracking.
- Everything they keep is a small file on your own computer, which you can read or delete at any time.

## What each add-on keeps on your computer

| Add-on | What it keeps | Where |
| --- | --- | --- |
| Task Progress Bar | Nothing. It only reads Claude's to-do list while the chat runs. | (none) |
| Session Status Markers | One small status file per chat: its state (working, waiting, done), its to-do progress, the chat's title and the title it last wrote, the project folder, and the account name if known. | `~/.claude-session-status/` |
| Usage Limits Monitor | One small status file per chat: the account name, the model, its 5-hour and weekly use and cost as Claude Code reports them, the context window, the project folder, the current step and a shortened copy of your last request. | `~/.claude-accounts/status/` |
| Sidebar Folders | Your folder rules, and a note of which chats it has already filed. | `~/.claude/sidebar-folders.json`, `~/.claude/sidebar-folders/filed/` |

These files never leave your computer. They are kept until you delete them; each add-on's README says how.

## What they read

- Claude Code's own events in the chat they run in (for example the to-do list, the current step, or the chat's title).
- The Claude desktop app's sidebar and chat details, through the app's own tools, to show markers and file chats into folders. Changes stay inside the app.
- Usage Limits Monitor reads `~/.claude-accounts/config.json`, if you made one, to name your accounts.

## Programs they run

Only Session Status Markers runs another program: the macOS `open` command, when you click a chat in its board, to open that chat in the desktop app.

## Children

The add-ons are developer tools and are not meant for anyone under 18.

## Changes and contact

Any change to this policy is made in this file, so its history on GitHub shows every version. Questions: open an issue at https://github.com/SouravAggarwal/Claude-Tools/issues
