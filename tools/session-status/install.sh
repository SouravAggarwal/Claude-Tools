#!/bin/bash
# Installs session-status for every project on this computer.
# Run it from a clone of Claude Tools:  tools/session-status/install.sh
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
command -v claude >/dev/null || { echo "Missing: claude. Install Claude Code, then run this again."; exit 1; }

# The add-on is read straight from this folder, so `git pull` and then /reload-plugins updates it.
claude plugin marketplace add "$repo" >/dev/null 2>&1 || true
# Set the default markers (A) only when none is stored, so a second run keeps the person's choice.
settings="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
config=(--config markers=A)
if command -v jq >/dev/null && [ -f "$settings" ] &&
  [ "$(jq -r '.pluginConfigs["session-status@claude-tools"].options.markers // empty' "$settings")" != "" ]; then
  config=()
fi
claude plugin install session-status@claude-tools --scope user ${config[@]+"${config[@]}"}

echo "Installed. Start a new chat, or type /reload-plugins in an open one. Type /sessions to see the board."
