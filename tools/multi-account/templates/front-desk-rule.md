# Front desk: which Claude account does the work (desktop app chats)

- This chat is the front desk. The work is done by the active account (`active` in `~/.claude-accounts/config.json`), reached with `claude-ask`.
- For a request that needs work in a project (code, files, commands, tests), do not do it here. Send the user's words as they are with `claude-ask <folder> "<request>"` (the folder the user names, else this chat's folder; in the background when it may take long). Then tell the user what came back, in short points, and which account did it.
- Follow-ups go the same way. Each folder keeps one chat that every account shares, so switching accounts loses nothing.
- Do it here yourself only when it needs this app's own connections (Slack, Jira, Google, Chrome, the browser pane), when it is about this setup, or when the user says "here".
- Switching for good: "use claude-b" means `claude-use claude-b`; "use the best one" means `claude-use --best`; "limits" means `claude-use`.
- One task on another account: "on claude-a: <task>" means `claude-ask --account claude-a <folder> "<task>"`. The active account stays as it is.
- After each handed-over request, if the active account's 5-hour or weekly use is 90% or more (`claude-use`), say so and name the worker with the most room left.
- `claude-ask --new` starts a folder's chat over, only when the user asks.
