# Agent guide: install sidebar-folders

You are installing a Claude Code add-on that files the Claude desktop app's chats into sidebar folders with names the person chooses: by project folder or title words, by following the chat that started them, or by hand with `/folder <name>`. Follow these steps in order. Each command is safe to run more than once.

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
~/.claude-tools/tools/sidebar-folders/install.sh
```

It installs the add-on for every project. It writes no settings and no rules. If your own safety rules stop you from installing add-ons for the person, show them this command and let them run it.

## 4. Check that it worked

```bash
claude plugin list
```

`sidebar-folders@claude-tools` must show as enabled.

## 5. Rules (only if the person asked for them)

If the person told you which folders they want and what goes in each, write them to `~/.claude/sidebar-folders.json`. Keep any rules already in the file. Shape:

```json
{
  "followParent": true,
  "rules": [
    { "name": "Code reviews", "titles": ["review"] },
    { "name": "Shop app", "projects": ["~/code/shop"] }
  ]
}
```

- `name`: the folder's name. `projects`: folders (a chat inside one matches). `titles`: words in the chat's title (any case).
- Rules are checked top to bottom; the first match wins.
- Never make up names. If the person gave none, skip this step: they can use `/folder <name> --project` in a chat.

## 6. Tell the person

- It works in **new** desktop chats.
- `/folder <name>` moves the chat into that folder (made if new). Add `--project` to send every new chat from that project folder there too. `/folder none` takes it out. `/folder` alone shows where the chat is.
- A chat Claude starts from another chat goes into the same folder.
- A chat is filed once, and never one that is already in a folder.
- Pinned cannot hold folders: that is the app's own section.
- What changed: the add-on is installed. Filed chats are noted in `~/.claude/sidebar-folders/filed/`. Rules (if any) are in `~/.claude/sidebar-folders.json`.
- How to remove it: `~/.claude-tools/tools/sidebar-folders/uninstall.sh`

## Uninstall (only when asked)

```bash
~/.claude-tools/tools/sidebar-folders/uninstall.sh
```

It keeps the folders in the sidebar and the rules file, and prints how to delete the rules. Only delete them if the person asks.

## If something fails

| Symptom | What to do |
| --- | --- |
| `claude plugin install` says the plugin is not in the marketplace | Run `claude plugin marketplace update claude-tools`, then step 3 again. |
| A new chat did not move | Check the rule in `~/.claude/sidebar-folders.json`: the chat's folder must be inside one of `projects`, or its title must hold one of `titles`. A chat already in a folder is never moved. |
| `/folder` says it works only in the desktop app | That chat runs in a terminal, which has no sidebar. |
| Nothing at all | Run `claude -p "hi" --debug-file /tmp/claude-debug.log` and `grep sidebar-folders /tmp/claude-debug.log`. "rollout flag ... is off" means Claude Code is too old: `claude update`. |
