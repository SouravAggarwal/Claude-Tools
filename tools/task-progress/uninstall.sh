#!/bin/bash
# Removes the task progress bar.
# Usage: tools/task-progress/uninstall.sh [--keep-checklists]
#   --keep-checklists  leave Claude's checklist tools on (they are useful without the bar too)
set -euo pipefail

settings="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"

claude plugin uninstall task-progress@claude-tools || true

if [ "${1:-}" != "--keep-checklists" ] && [ -f "$settings" ]; then
  jq 'del(.env.CLAUDE_CODE_ENABLE_TODO_TOOLS)' "$settings" > "$settings.tmp" && mv "$settings.tmp" "$settings"
fi

echo "Removed. Open chats drop the bar after /reload-plugins; new chats never load it."
