#!/bin/bash
# Installs multi-account: the commands, the account-status add-on and the desktop front desk.
# Run it from a clone of Claude Tools:  tools/multi-account/install.sh
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
bin="$HOME/.local/bin"
accounts="$HOME/.claude-accounts"
settings="$HOME/.claude/settings.json"
for needed in claude jq python3; do
  command -v "$needed" >/dev/null || { echo "Missing: $needed. Install it, then run this again."; exit 1; }
done
mkdir -p "$bin" "$accounts/status" "$HOME/.claude"

# 1. The commands, linked to this folder so `git pull` updates them.
for tool in claude-ask claude-use claude-accounts claude-accounts-add claude-as; do
  ln -sf "$here/bin/$tool" "$bin/$tool"
done

# 2. Your account list and the front-desk rule (an existing one is kept as it is).
[ -f "$accounts/config.json" ] || cp "$here/templates/config.json" "$accounts/config.json"
[ -f "$accounts/front-desk-rule.md" ] || cp "$here/templates/front-desk-rule.md" "$accounts/front-desk-rule.md"

# 3. Desktop app chats load the front-desk rule when they start. Terminal and worker chats never do.
[ -f "$settings" ] || echo '{}' > "$settings"
hook='[ "$CLAUDE_CODE_ENTRYPOINT" = "claude-desktop" ] || exit 0; f="$HOME/.claude-accounts/front-desk-rule.md"; [ -f "$f" ] || exit 0; jq -n --rawfile c "$f" '"'"'{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$c}}'"'"
jq --arg cmd "$hook" '
  .hooks.SessionStart = (((.hooks.SessionStart // []) | map(select(any(.hooks[]?; .command == $cmd) | not)))
    + [{hooks: [{type: "command", command: $cmd, timeout: 10, statusMessage: "Loading front-desk rule"}]}])
' "$settings" > "$settings.tmp" && mv "$settings.tmp" "$settings"

# 4. The account-status add-on, for the account the desktop app is signed in to.
claude plugin marketplace add "$repo" >/dev/null 2>&1 || true
claude plugin install account-status@claude-tools --scope user

case ":$PATH:" in
  *":$bin:"*) ;;
  *) echo "Note: add $bin to your PATH so the commands are found." ;;
esac

cat <<'NEXT'

Installed. Next:
  1. Add the account your desktop app is signed in to:   claude-accounts-add claude-a "you@example.com" --desktop
  2. Add each other account:                               claude-accounts-add claude-b "other@example.com"
  3. Sign each one in with the line it prints, then pick the one to work:   claude-use claude-b
  4. Start a new desktop chat and ask as usual. Type /accounts or run claude-accounts to watch the limits.
NEXT
