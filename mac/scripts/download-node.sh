#!/bin/bash
#
# Download and cache Node.js runtime for VibeTunnel Mac app
# This script downloads the official Node.js binary for macOS
#

set -euo pipefail

# Configuration
NODE_VERSION="20.18.0"  # LTS version
NODE_BASE_URL="https://nodejs.org/dist/v${NODE_VERSION}"
CACHE_DIR="$HOME/.vibetunnel/cache"
NODE_CACHE_DIR="$CACHE_DIR/node-v${NODE_VERSION}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
# Store in a temporary location outside of Xcode's Resources
TEMP_DIR="$SCRIPT_DIR/../.build-cache"
NODE_DIR="$TEMP_DIR/node"

echo -e "${GREEN}Setting up Node.js ${NODE_VERSION} for VibeTunnel...${NC}"

# Create cache directory
mkdir -p "$CACHE_DIR"

# Function to download Node.js
download_node() {
    local arch=$1
    local filename="node-v${NODE_VERSION}-darwin-${arch}.tar.gz"
    local url="${NODE_BASE_URL}/${filename}"
    local cache_file="$CACHE_DIR/${filename}"
    
    if [ ! -f "$cache_file" ]; then
        echo "Downloading Node.js ${NODE_VERSION} for ${arch}..." >&2
        curl -L -o "$cache_file" "$url" || {
            echo -e "${RED}Failed to download Node.js for ${arch}${NC}" >&2
            rm -f "$cache_file"
            return 1
        }
    else
        echo "Using cached Node.js ${NODE_VERSION} for ${arch}" >&2
    fi
    
    # Extract to cache directory
    local extract_dir="$CACHE_DIR/node-v${NODE_VERSION}-darwin-${arch}"
    if [ ! -d "$extract_dir" ]; then
        echo "Extracting Node.js for ${arch}..." >&2
        tar -xzf "$cache_file" -C "$CACHE_DIR"
    fi
    
    echo "$extract_dir"
}

# Create directories
mkdir -p "$TEMP_DIR"
mkdir -p "$NODE_DIR"

# Check if already built
if [ -f "$NODE_DIR/node" ]; then
    echo -e "${YELLOW}Node.js runtime already exists. Use --force to rebuild.${NC}"
    if [ "${1:-}" != "--force" ]; then
        exit 0
    fi
fi

# Detect current architecture
CURRENT_ARCH=$(uname -m)
if [ "$CURRENT_ARCH" = "arm64" ]; then
    CURRENT_ARCH_NODE="arm64"
else
    CURRENT_ARCH_NODE="x64"
fi

# Download both architectures
echo "Downloading Node.js for universal binary..."
ARM64_DIR=$(download_node "arm64")
X64_DIR=$(download_node "x64")

# Create universal binary
echo "Creating universal binary..."

# Extract the node binaries
ARM64_NODE="$ARM64_DIR/bin/node"
X64_NODE="$X64_DIR/bin/node"

if [ ! -f "$ARM64_NODE" ] || [ ! -f "$X64_NODE" ]; then
    echo -e "${RED}Error: Node binaries not found${NC}"
    exit 1
fi

# Create universal binary using lipo
lipo -create "$ARM64_NODE" "$X64_NODE" -output "$NODE_DIR/node"

# Make executable
chmod +x "$NODE_DIR/node"

# Verify the universal binary
echo "Verifying universal binary..."
lipo -info "$NODE_DIR/node"

# Test the binary
echo "Testing Node.js binary..."
"$NODE_DIR/node" --version

# Copy required libraries and files
echo "Copying Node.js support files..."

# Copy the lib directory (needed for some native modules)
if [ -d "$ARM64_DIR/lib" ]; then
    cp -r "$ARM64_DIR/lib" "$NODE_DIR/"
fi

# Sign the binary for macOS
echo "Signing Node.js binary..."
codesign --force --sign - "$NODE_DIR/node" || {
    echo -e "${YELLOW}Warning: Failed to sign Node.js binary. This may cause issues on macOS.${NC}"
}

# Calculate size
NODE_SIZE=$(du -sh "$NODE_DIR" | cut -f1)

echo -e "${GREEN}✓ Node.js runtime setup complete!${NC}"
echo -e "  Location: $NODE_DIR"
echo -e "  Version: ${NODE_VERSION}"
echo -e "  Size: $NODE_SIZE"
echo -e "  Architecture: Universal (arm64 + x64)"