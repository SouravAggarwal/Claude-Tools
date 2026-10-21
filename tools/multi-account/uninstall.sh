#!/bin/bash
# Removes multi-account: the commands, the front-desk rule hook and the account-status add-on.
# Your accounts' folders, sign-ins and shared chats in ~/.claude-accounts are kept; the end of this
# script prints how to remove them too.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
bin="$HOME/.local/bin"
settings="$HOME/.claude/settings.json"

# 1. The commands (only the links that point into this folder).
for tool in claude-ask claude-use claude-accounts claude-accounts-add claude-as; do
  if [ -L "$bin/$tool" ] && [ "$(readlink "$bin/$tool")" = "$here/bin/$tool" ]; then
    rm "$bin/$tool"
  fi
done

# 2. The front-desk hook in the desktop app's settings.
if [ -f "$settings" ]; then
  jq '.hooks.SessionStart = ((.hooks.SessionStart // []) | map(select(any(.hooks[]?; (.command // "") | contains("front-desk-rule.md")) | not)))' \
    "$settings" > "$settings.tmp" && mv "$settings.tmp" "$settings"
fi

# 3. The account-status add-on, for the desktop app's account and every worker.
claude plugin uninstall account-status@claude-tools || true
if [ -f "$HOME/.claude-accounts/config.json" ]; then
  for dir in $(jq -r '.accounts[].configDir' "$HOME/.claude-accounts/config.json"); do
    CLAUDE_CONFIG_DIR="${dir/#\~/$HOME}" claude plugin uninstall account-status@claude-tools >/dev/null 2>&1 || true
  done
fi

cat <<'DONE'

Removed. Kept: ~/.claude-accounts (account list, worker folders, shared chats).
To sign a worker out:   CLAUDE_CONFIG_DIR=~/.claude-accounts/homes/TAG claude auth logout
To delete it all too:   rm -r ~/.claude-accounts
DONE
