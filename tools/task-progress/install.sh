#!/bin/bash
# Installs the task progress bar for every project on this computer.
# Run it from a clone of Claude Tools:  tools/task-progress/install.sh
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
settings="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
for needed in claude jq; do
  command -v "$needed" >/dev/null || { echo "Missing: $needed. Install it, then run this again."; exit 1; }
done

# The add-on is read straight from this folder, so `git pull` and then /reload-plugins updates it.
claude plugin marketplace add "$repo" >/dev/null 2>&1 || true
claude plugin install task-progress@claude-tools --scope user

# Claude's checklist tools are off by default on newer models, and the bar needs them.
mkdir -p "$(dirname "$settings")"
[ -f "$settings" ] || echo '{}' > "$settings"
jq '.env.CLAUDE_CODE_ENABLE_TODO_TOOLS = "1"' "$settings" > "$settings.tmp" && mv "$settings.tmp" "$settings"

echo "Installed. Start a new chat, or type /reload-plugins in an open one."
