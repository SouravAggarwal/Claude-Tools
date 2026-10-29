#!/bin/bash
# Removes session-status. Its status files stay; the last line says how to remove them.
set -euo pipefail

command -v claude >/dev/null || { echo "Missing: claude."; exit 1; }
claude plugin uninstall session-status@claude-tools || true

echo "Removed. Open chats drop it after /reload-plugins; new chats never load it."
echo "A chat's sidebar title keeps its last marker until you rename it."
echo "The status files are still in ~/.claude-session-status. To delete them too: rm -rf ~/.claude-session-status"
