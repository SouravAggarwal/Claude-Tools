#!/bin/bash
# Installs sidebar-folders for every project on this computer.
# Run it from a clone of Claude Tools:  tools/sidebar-folders/install.sh
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
command -v claude >/dev/null || { echo "Missing: claude. Install Claude Code, then run this again."; exit 1; }

# The add-on is read straight from this folder, so `git pull` and then /reload-plugins updates it.
claude plugin marketplace add "$repo" >/dev/null 2>&1 || true
# A marketplace added before this add-on existed needs a refresh to list it.
claude plugin marketplace update claude-tools >/dev/null 2>&1 || true
claude plugin install sidebar-folders@claude-tools --scope user
# Claude runs a saved copy of the add-on; a second run brings that copy up to this folder's version.
claude plugin update sidebar-folders@claude-tools --scope user >/dev/null 2>&1 || true

rules="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sidebar-folders.json"
echo "Installed. Start a new chat in the desktop app, or type /reload-plugins in an open one."
echo "Move a chat: /folder <name>. Send new chats from a project there too: /folder <name> --project."
if [ ! -f "$rules" ]; then
  echo "Rules file (made the first time you use --project): $rules"
fi
