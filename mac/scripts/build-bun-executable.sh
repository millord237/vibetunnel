#!/bin/bash
#
# Build and copy Bun executable and native modules to the app bundle
# ARM64 only - VibeTunnel requires Apple Silicon
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$SCRIPT_DIR/../.."
WEB_DIR="$PROJECT_ROOT/web"
NATIVE_DIR="$WEB_DIR/native"

# Destination from Xcode (passed as argument or use BUILT_PRODUCTS_DIR)
if [ $# -eq 0 ]; then
    if [ -z "${BUILT_PRODUCTS_DIR:-}" ]; then
        echo -e "${RED}Error: No destination path provided and BUILT_PRODUCTS_DIR not set${NC}"
        exit 1
    fi
    DEST_RESOURCES="${BUILT_PRODUCTS_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}"
else
    DEST_RESOURCES="$1"
fi

echo -e "${GREEN}Building and copying Bun executable (ARM64 only)...${NC}"

# Change to web directory
cd "$WEB_DIR"

# Check if native directory exists, if not build it
if [ ! -d "$NATIVE_DIR" ] || [ ! -f "$NATIVE_DIR/vibetunnel" ]; then
    echo -e "${YELLOW}Native directory not found or incomplete. Building Bun executable...${NC}"
    
    # Check if build-native.js exists
    if [ -f "build-native.js" ]; then
        # Ensure we have bun installed
        if command -v bun &> /dev/null; then
            echo "Using bun to build..."
            bun build-native.js
        elif command -v node &> /dev/null; then
            echo "Using node to build..."
            node build-native.js
        else
            echo -e "${RED}Error: Neither bun nor node found. Cannot build native executable.${NC}"
            exit 1
        fi
    else
        echo -e "${RED}Error: build-native.js not found in web directory${NC}"
        exit 1
    fi
fi

# Verify native files exist
if [ ! -f "$NATIVE_DIR/vibetunnel" ]; then
    echo -e "${RED}Error: Bun executable not found at $NATIVE_DIR/vibetunnel${NC}"
    exit 1
fi

# Copy Bun executable
echo "Copying Bun executable to app bundle..."
cp "$NATIVE_DIR/vibetunnel" "$DEST_RESOURCES/"
chmod +x "$DEST_RESOURCES/vibetunnel"

# Copy native modules
if [ -f "$NATIVE_DIR/pty.node" ]; then
    echo "Copying pty.node..."
    cp "$NATIVE_DIR/pty.node" "$DEST_RESOURCES/"
else
    echo -e "${RED}Error: pty.node not found${NC}"
    exit 1
fi

if [ -f "$NATIVE_DIR/spawn-helper" ]; then
    echo "Copying spawn-helper..."
    cp "$NATIVE_DIR/spawn-helper" "$DEST_RESOURCES/"
    chmod +x "$DEST_RESOURCES/spawn-helper"
else
    echo -e "${RED}Error: spawn-helper not found${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Bun executable and native modules copied successfully${NC}"

# Verify the files
echo "Verifying copied files:"
ls -la "$DEST_RESOURCES/vibetunnel" || echo "vibetunnel not found!"
ls -la "$DEST_RESOURCES/pty.node" || echo "pty.node not found!"
ls -la "$DEST_RESOURCES/spawn-helper" || echo "spawn-helper not found!"

echo ""
echo -e "${GREEN}Note: VibeTunnel requires Apple Silicon (M1/M2/M3) Macs.${NC}"