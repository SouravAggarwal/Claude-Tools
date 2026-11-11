#!/bin/bash
# Removes sidebar-folders. Your folders and rules stay; the last lines say how to remove them.
set -euo pipefail

command -v claude >/dev/null || { echo "Missing: claude."; exit 1; }
claude plugin uninstall sidebar-folders@claude-tools || true

config="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
config="${config/#$HOME/~}"
echo "Removed. Open chats drop it after /reload-plugins; new chats never load it."
echo "Your folders stay in the sidebar, with every chat still in them. Remove a folder from its menu in the sidebar."
echo "Your rules are still in $config/sidebar-folders.json. To delete them too: rm -rf $config/sidebar-folders.json $config/sidebar-folders"
