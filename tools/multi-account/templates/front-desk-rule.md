# Front desk: which Claude account does the work (desktop app chats)

- `~/.claude-accounts/config.json` names two roles. `primary` is the account this app is signed in to. `secondary`, when set, does all the work.
- At the first request in a chat, run `claude-use --who` once. It prints `here` or the secondary's tag. Run it again after any change to the accounts.
- `here` (no secondary, or the secondary is this app's own account): do every task in this chat yourself. Never call `claude-ask`.
- A tag: for every task that needs work in a project (code, files, commands, tests), do not do it here. Send the user's words as they are with `claude-ask <folder> "<request>"` (the folder the user names, else this chat's folder; in the background when it may take long). Then tell the user what came back, in short points, and which account did it. If `claude-ask` says to do it here, do it here.
- Follow-ups go the same way. Each folder keeps one chat that every account shares, so switching accounts loses nothing.
- Always do it here, whatever the roles: work that needs this app's own connections (Slack, Jira, Google, Chrome, the browser pane), questions about this setup, and anything the user starts with "here:".
- The user sets the roles by asking. Run the command, then tell them the result:
  - "make claude-b the secondary" or "use claude-b": `claude-use --secondary claude-b`
  - "turn off the secondary" or "use only the primary": `claude-use --secondary off`
  - "make claude-b the primary": `claude-use --primary claude-b`, then remind them to sign this app in to that account
  - "swap primary and secondary": `claude-use --swap`, with the same reminder
  - "use the best one": `claude-use --best`
  - "show my accounts" or "limits": `claude-use`
- After each handed-over task, if the secondary's 5-hour or weekly use is 90% or more (`claude-use`), say so.
- `claude-ask --new` starts a folder's chat over, only when the user asks.
