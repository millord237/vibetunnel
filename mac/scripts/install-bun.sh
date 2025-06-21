#!/bin/bash
#
# Install Bun locally for the build process if not already available
#
# This script ensures Bun is available for building VibeTunnel without
# requiring any pre-installed tools except Xcode.
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Script directory and paths
# Handle both bash and zsh
if [ -n "${BASH_SOURCE[0]:-}" ]; then
    SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
else
    SCRIPT_DIR="$( cd "$( dirname "$0" )" && pwd )"
fi
PROJECT_DIR="$SCRIPT_DIR/.."
BUILD_TOOLS_DIR="$PROJECT_DIR/.build-tools"
BUN_DIR="$BUILD_TOOLS_DIR/bun"
BUN_BINARY="$BUN_DIR/bin/bun"

# Version management - update this to use a specific Bun version
BUN_VERSION="latest"

echo -e "${GREEN}Checking for Bun...${NC}"

# Function to install Bun
install_bun() {
    echo -e "${YELLOW}Bun not found. Installing Bun locally...${NC}"
    
    # Create build tools directory
    mkdir -p "$BUILD_TOOLS_DIR"
    
    # Download and install Bun to local directory
    echo "Downloading Bun..."
    export BUN_INSTALL="$BUN_DIR"
    
    # Use curl to download the install script and execute it
    if command -v curl &> /dev/null; then
        curl -fsSL https://bun.sh/install | bash > /dev/null 2>&1
    else
        echo -e "${RED}Error: curl is required to download Bun${NC}"
        echo "curl should be available on macOS by default"
        exit 1
    fi
    
    # Verify installation
    if [ -f "$BUN_BINARY" ]; then
        echo -e "${GREEN}✓ Bun installed successfully${NC}"
        "$BUN_BINARY" --version
    else
        echo -e "${RED}Error: Bun installation failed${NC}"
        exit 1
    fi
}

# Check if Bun is already in PATH
if command -v bun &> /dev/null; then
    echo -e "${GREEN}✓ Bun found in PATH: $(which bun)${NC}"
    echo "  Version: $(bun --version)"
    exit 0
fi

# Check if we have a local Bun installation
if [ -f "$BUN_BINARY" ]; then
    echo -e "${GREEN}✓ Bun found locally: $BUN_BINARY${NC}"
    echo "  Version: $("$BUN_BINARY" --version)"
    
    # Export path for use in other scripts
    echo "export PATH=\"$BUN_DIR/bin:\$PATH\""
    exit 0
fi

# No Bun found, install it
install_bun

# Export path for use in other scripts
echo "export PATH=\"$BUN_DIR/bin:\$PATH\""