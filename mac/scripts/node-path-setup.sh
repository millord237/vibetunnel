#!/bin/bash
# node-path-setup.sh
# -------------------------------------------------------------
# Common helper to ensure Node.js managers add their binaries to
# PATH for VibeTunnel build scripts. Source this instead of
# duplicating logic in every script.
#
# Usage (Bash):
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-${0}}")" && pwd)"
#   source "${SCRIPT_DIR}/node-path-setup.sh"
# Usage (Zsh):
#   SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
#   source "${SCRIPT_DIR}/node-path-setup.sh"
# -------------------------------------------------------------

# Homebrew (Apple Silicon & Intel)
if [ -d "/opt/homebrew/bin" ]; then
    export PATH="/opt/homebrew/bin:$PATH"
fi
if [ -d "/usr/local/bin" ]; then
    export PATH="/usr/local/bin:$PATH"
fi

# NVM default location
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    . "$NVM_DIR/nvm.sh"
fi

# Volta
if [ -d "$HOME/.volta/bin" ]; then
    export PATH="$HOME/.volta/bin:$PATH"
fi

# fnm (Fast Node Manager)
if command -v fnm &> /dev/null; then
    eval "$(fnm env)"
fi
