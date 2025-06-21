#!/bin/bash
#
# Setup pre-built Bun binaries for universal app support
#
# This script copies the current architecture's Bun binaries to the prebuilts directory
# and can also download pre-built binaries for other architectures if needed.
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/../.."
MAC_DIR="$SCRIPT_DIR/.."
WEB_DIR="$PROJECT_ROOT/web"
PREBUILTS_DIR="$MAC_DIR/Resources/BunPrebuilts"

# Get current architecture
CURRENT_ARCH=$(uname -m)
if [ "$CURRENT_ARCH" = "x86_64" ]; then
    ARCH_DIR="x86_64"
else
    ARCH_DIR="arm64"
fi

echo -e "${BLUE}Setting up Bun prebuilt binaries...${NC}"
echo "Current architecture: $CURRENT_ARCH"

# Function to build and copy binaries for current architecture
build_current_arch() {
    echo -e "${YELLOW}Building Bun binaries for $CURRENT_ARCH...${NC}"
    
    cd "$WEB_DIR"
    
    # Build if native directory doesn't exist
    if [ ! -f "native/vibetunnel" ]; then
        echo "Building Bun executable..."
        if command -v bun &> /dev/null; then
            bun build-native.js
        elif command -v node &> /dev/null; then
            node build-native.js
        else
            echo -e "${RED}Error: Neither bun nor node found. Cannot build.${NC}"
            exit 1
        fi
    fi
    
    # Create architecture directory
    mkdir -p "$PREBUILTS_DIR/$ARCH_DIR"
    
    # Copy binaries
    echo "Copying binaries to prebuilts directory..."
    cp -f native/vibetunnel "$PREBUILTS_DIR/$ARCH_DIR/"
    cp -f native/pty.node "$PREBUILTS_DIR/$ARCH_DIR/"
    cp -f native/spawn-helper "$PREBUILTS_DIR/$ARCH_DIR/"
    
    # Make executables executable
    chmod +x "$PREBUILTS_DIR/$ARCH_DIR/vibetunnel"
    chmod +x "$PREBUILTS_DIR/$ARCH_DIR/spawn-helper"
    
    echo -e "${GREEN}✓ Copied $CURRENT_ARCH binaries to prebuilts${NC}"
}

# Function to check prebuilt status
check_status() {
    echo -e "\n${BLUE}Prebuilt binaries status:${NC}"
    
    for arch in arm64 x86_64; do
        echo -n "  $arch: "
        if [ -f "$PREBUILTS_DIR/$arch/vibetunnel" ] && \
           [ -f "$PREBUILTS_DIR/$arch/pty.node" ] && \
           [ -f "$PREBUILTS_DIR/$arch/spawn-helper" ]; then
            echo -e "${GREEN}✓ Complete${NC}"
            ls -lh "$PREBUILTS_DIR/$arch/" | grep -E "vibetunnel|pty.node|spawn-helper"
        else
            echo -e "${YELLOW}⚠ Missing${NC}"
            if [ -d "$PREBUILTS_DIR/$arch" ]; then
                echo "    Found:"
                ls -la "$PREBUILTS_DIR/$arch/" 2>/dev/null || echo "    (empty)"
            fi
        fi
    done
}

# Main logic
case "${1:-build}" in
    build)
        build_current_arch
        check_status
        ;;
    status)
        check_status
        ;;
    clean)
        echo -e "${YELLOW}Cleaning prebuilt binaries...${NC}"
        rm -rf "$PREBUILTS_DIR"/{arm64,x86_64}
        mkdir -p "$PREBUILTS_DIR"/{arm64,x86_64}
        echo -e "${GREEN}✓ Cleaned${NC}"
        ;;
    *)
        echo "Usage: $0 [build|status|clean]"
        echo "  build  - Build and copy binaries for current architecture (default)"
        echo "  status - Check status of prebuilt binaries"
        echo "  clean  - Remove all prebuilt binaries"
        exit 1
        ;;
esac

echo -e "\n${BLUE}Note:${NC} To support both architectures, run this script on both"
echo "      an Intel Mac and an Apple Silicon Mac, then commit the results."