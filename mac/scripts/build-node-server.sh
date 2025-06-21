#!/bin/bash
#
# Build script for Node.js VibeTunnel server bundle
# This script creates a standalone Node.js server package for the Mac app
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
# Store in a temporary location outside of Xcode's Resources
TEMP_DIR="$SCRIPT_DIR/../.build-cache"
NODE_SERVER_DIR="$TEMP_DIR/node-server"
NODE_BIN="$TEMP_DIR/node/node"

# Check if bundled node exists
if [ ! -f "$NODE_BIN" ]; then
    echo -e "${YELLOW}Warning: Bundled Node.js not found. Using system Node.js.${NC}"
    NODE_BIN="node"
    NPM_BIN="npm"
    NPX_BIN="npx"
else
    # Use bundled Node.js for compatibility
    NODE_DIR="$(dirname "$NODE_BIN")"
    NPM_BIN="$NODE_BIN $NODE_DIR/lib/node_modules/npm/bin/npm-cli.js"
    NPX_BIN="$NODE_BIN $NODE_DIR/lib/node_modules/npm/bin/npx-cli.js"
fi

echo -e "${GREEN}Building Node.js VibeTunnel server bundle...${NC}"

# Check if web directory exists
if [ ! -d "$WEB_DIR" ]; then
    echo -e "${RED}Error: Web directory not found at $WEB_DIR${NC}"
    exit 1
fi

# Clean previous build
if [ -d "$NODE_SERVER_DIR" ]; then
    echo "Cleaning previous build..."
    rm -rf "$NODE_SERVER_DIR"
fi

# Create server directory structure
mkdir -p "$NODE_SERVER_DIR"
mkdir -p "$NODE_SERVER_DIR/dist"
mkdir -p "$NODE_SERVER_DIR/public"

# Change to web directory
cd "$WEB_DIR"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    # Ensure npm can find node
    if [ -f "$NODE_BIN" ] && [ "$NODE_BIN" != "node" ]; then
        export PATH="$(dirname "$NODE_BIN"):$PATH"
    else
        export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
    fi
    $NPM_BIN ci
fi

# Build TypeScript
echo "Compiling TypeScript..."
# Use the web directory's built files instead of compiling here
if [ ! -d "$WEB_DIR/dist" ]; then
    echo -e "${YELLOW}Warning: dist directory not found. Running npm run build:server...${NC}"
    cd "$WEB_DIR"
    
    # Use the bundled npm if available, otherwise use system npm
    if [ -f "$NODE_BIN" ] && [ "$NODE_BIN" != "node" ]; then
        # Use bundled npm with explicit node path
        echo "Using bundled Node.js for TypeScript compilation..."
        export PATH="$(dirname "$NODE_BIN"):$PATH"
        $NPM_BIN run build:server || {
            echo -e "${RED}Failed to build TypeScript server${NC}"
            exit 1
        }
    else
        # Try system npm with common paths
        echo "Using system Node.js for TypeScript compilation..."
        export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
        if command -v npm &> /dev/null; then
            npm run build:server || {
                echo -e "${RED}Failed to build TypeScript server${NC}"
                exit 1
            }
        else
            echo -e "${RED}Error: npm not found. Please ensure Node.js is installed or dist directory exists${NC}"
            echo -e "${YELLOW}You can pre-build the server by running 'npm run build:server' in the web directory${NC}"
            exit 1
        fi
    fi
    
fi

# Ensure we're in the web directory for copying files
cd "$WEB_DIR"

# Copy server files
echo "Copying server files..."
# Copy the main entry point (index.js)
if [ -f "dist/index.js" ]; then
    cp dist/index.js "$NODE_SERVER_DIR/dist/"
    cp dist/index.js.map "$NODE_SERVER_DIR/dist/" 2>/dev/null || true
fi
# Copy server directory
if [ -d "dist/server" ]; then
    cp -r dist/server "$NODE_SERVER_DIR/dist/"
fi
# Copy client directory if it exists
if [ -d "dist/client" ]; then
    cp -r dist/client "$NODE_SERVER_DIR/dist/"
fi
# Copy test directory if it exists
if [ -d "dist/test" ]; then
    cp -r dist/test "$NODE_SERVER_DIR/dist/"
fi

# Copy public files (static assets)
echo "Copying static assets..."
if [ -d "public" ]; then
    cp -r public/* "$NODE_SERVER_DIR/public/" 2>/dev/null || true
else
    echo "Warning: public directory not found, skipping static assets"
fi

# Create minimal package.json for the server
echo "Creating server package.json..."
cat > "$NODE_SERVER_DIR/package.json" << EOF
{
  "name": "vibetunnel-server",
  "version": "1.0.0",
  "main": "dist/server.js",
  "scripts": {
    "start": "node dist/server.js"
  },
  "dependencies": {
    "@homebridge/node-pty-prebuilt-multiarch": "^0.12.0",
    "@xterm/headless": "^5.5.0",
    "chalk": "^4.1.2",
    "express": "^4.19.2",
    "lit": "^3.3.0",
    "signal-exit": "^4.1.0",
    "ws": "^8.18.2",
    "uuid": "^11.1.0"
  }
}
EOF

# Install production dependencies only
echo "Installing production dependencies..."
cd "$NODE_SERVER_DIR"

# CRITICAL: Ensure we use the bundled Node.js for everything
# This prevents version mismatches with native modules
export PATH="$NODE_DIR:$PATH"
export NODE="$NODE_BIN"

# Install with the bundled npm, ignoring scripts to skip compilation
"$NODE_BIN" "$NODE_DIR/lib/node_modules/npm/bin/npm-cli.js" install --production --no-audit --no-fund --ignore-scripts

# Install prebuilt binaries for node-pty manually
echo "Installing prebuilt binaries for node-pty..."
if [ -d "node_modules/@homebridge/node-pty-prebuilt-multiarch" ]; then
    cd node_modules/@homebridge/node-pty-prebuilt-multiarch
    
    # Determine Node ABI version (v115 for Node 20)
    NODE_ABI="v115"
    ARCH=$(uname -m)
    if [ "$ARCH" = "arm64" ]; then
        PTY_ARCH="arm64"
    else
        PTY_ARCH="x64"
    fi
    
    # Download prebuilt binary
    PREBUILT_URL="https://github.com/homebridge/node-pty-prebuilt-multiarch/releases/download/v0.12.0/node-pty-prebuilt-multiarch-v0.12.0-node-${NODE_ABI}-darwin-${PTY_ARCH}.tar.gz"
    echo "Downloading prebuilt binary from $PREBUILT_URL..."
    
    if curl -L -o prebuilt.tar.gz "$PREBUILT_URL" 2>/dev/null; then
        tar -xzf prebuilt.tar.gz
        rm prebuilt.tar.gz
        echo "✓ Prebuilt binary installed successfully"
    else
        echo "Warning: Could not download prebuilt binary for node-pty"
    fi
    
    cd "$NODE_SERVER_DIR"
else
    echo "Warning: node-pty module not found"
fi

# Clean up unnecessary files
echo "Cleaning up..."
find node_modules -name "*.md" -type f -delete
find node_modules -name "*.txt" -type f -delete
find node_modules -name "test" -type d -exec rm -rf {} + 2>/dev/null || true
find node_modules -name "tests" -type d -exec rm -rf {} + 2>/dev/null || true
find node_modules -name "example" -type d -exec rm -rf {} + 2>/dev/null || true
find node_modules -name "examples" -type d -exec rm -rf {} + 2>/dev/null || true
find node_modules -name ".github" -type d -exec rm -rf {} + 2>/dev/null || true

# Create server launch script
echo "Creating server launcher..."
cat > "$NODE_SERVER_DIR/server.js" << 'EOF'
#!/usr/bin/env node

// VibeTunnel Node.js Server Launcher
// This script ensures proper environment setup before launching the main server

const path = require('path');
const { spawn } = require('child_process');

// Set up environment
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

// Ensure PORT is set
if (!process.env.PORT) {
    process.env.PORT = '4020';
}

// Launch the actual server
const serverPath = path.join(__dirname, 'dist', 'index.js');
const server = spawn(process.execPath, [serverPath], {
    stdio: 'inherit',
    env: process.env
});

// Handle signals
process.on('SIGTERM', () => {
    server.kill('SIGTERM');
});

process.on('SIGINT', () => {
    server.kill('SIGINT');
});

server.on('exit', (code) => {
    process.exit(code);
});
EOF

chmod +x "$NODE_SERVER_DIR/server.js"

# Calculate bundle size
BUNDLE_SIZE=$(du -sh "$NODE_SERVER_DIR" | cut -f1)

echo -e "${GREEN}✓ Node.js server bundle created successfully!${NC}"
echo -e "  Location: $NODE_SERVER_DIR"
echo -e "  Size: $BUNDLE_SIZE"
echo ""
echo -e "${YELLOW}Note: This bundle requires a Node.js runtime to execute.${NC}"
echo -e "${YELLOW}The Mac app will need to either bundle Node.js or use system Node.js.${NC}"