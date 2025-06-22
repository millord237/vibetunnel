#!/bin/bash
#
# Check for Node.js availability for the build process
#
# This script ensures Node.js is available for building VibeTunnel
#

set -uo pipefail

# Script directory and paths
if [ -n "${BASH_SOURCE[0]:-}" ]; then
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
else
    SCRIPT_DIR="$( cd "$( dirname "$0" )" && pwd )"
fi

echo "Checking for Node.js..."

# Add common Node.js installation paths to PATH
# Homebrew on Apple Silicon
if [ -d "/opt/homebrew/bin" ]; then
    export PATH="/opt/homebrew/bin:$PATH"
fi

# Homebrew on Intel Macs
if [ -d "/usr/local/bin" ]; then
    export PATH="/usr/local/bin:$PATH"
fi

# NVM default location
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    . "$NVM_DIR/nvm.sh"
fi

# Check if Node.js is available
if command -v node &> /dev/null; then
    echo "✓ Node.js found: $(which node)"
    echo "  Version: $(node --version)"
    
    # Check Node.js version (need v20+)
    NODE_VERSION=$(node --version | cut -d'v' -f2)
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d'.' -f1)
    
    if [ "$NODE_MAJOR" -lt 20 ]; then
        echo "Warning: Node.js v20+ is recommended (found v$NODE_VERSION)"
    fi
    
    # Check if npm is available
    if command -v npm &> /dev/null; then
        echo "✓ npm found: $(which npm)"
        echo "  Version: $(npm --version)"
    else
        echo "Error: npm not found. Please ensure Node.js is properly installed."
        exit 1
    fi
    
    exit 0
else
    echo "Error: Node.js not found in PATH"
    echo ""
    echo "Please install Node.js 20+ using one of these methods:"
    echo "  - Homebrew: brew install node"
    echo "  - Download from: https://nodejs.org/"
    echo "  - Using nvm: nvm install 20"
    echo ""
    echo "PATH checked: $PATH"
    exit 1
fi