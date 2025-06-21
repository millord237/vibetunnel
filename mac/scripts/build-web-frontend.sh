#!/bin/zsh
set -e  # Exit on any error

echo "Building web frontend..."

# Get the project directory
if [ -z "${SRCROOT}" ]; then
    # If SRCROOT is not set (running outside Xcode), determine it from script location
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
else
    PROJECT_DIR="${SRCROOT}"
fi

WEB_DIR="${PROJECT_DIR}/../web"
PUBLIC_DIR="${WEB_DIR}/public"

# Set destination directory
if [ -z "${BUILT_PRODUCTS_DIR}" ]; then
    # Default for testing outside Xcode
    DEST_DIR="/tmp/vibetunnel-web-build"
else
    DEST_DIR="${BUILT_PRODUCTS_DIR}/${CONTENTS_FOLDER_PATH}/Resources/web/public"
fi

# Setup PATH for Node.js
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Load NVM if available
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    . "$NVM_DIR/nvm.sh"
fi

# Export CI to prevent interactive prompts
export CI=true

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo "error: npm not found. Please install Node.js"
    exit 1
fi

echo "Using npm version: $(npm --version)"
echo "Using Node.js version: $(node --version)"

# Check if web directory exists
if [ ! -d "${WEB_DIR}" ]; then
    echo "error: Web directory not found at ${WEB_DIR}"
    exit 1
fi

# Change to web directory
cd "${WEB_DIR}"

# Clean build artifacts
echo "Cleaning build artifacts..."
rm -rf dist public/bundle public/output.css

# Install dependencies
echo "Installing dependencies..."
npm install

# Build the web frontend
echo "Building web frontend..."
npm run build

# Clean and create destination directory
echo "Cleaning destination directory..."
rm -rf "${DEST_DIR}"
mkdir -p "${DEST_DIR}"

# Copy built files to Resources
echo "Copying web files to app bundle..."
cp -R "${PUBLIC_DIR}/"* "${DEST_DIR}/"

# Copy native executable and modules to app bundle root
echo "Copying native executable and modules..."
NATIVE_DIR="${WEB_DIR}/native"
APP_RESOURCES="${BUILT_PRODUCTS_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}"

if [ -f "${NATIVE_DIR}/vibetunnel" ]; then
    cp "${NATIVE_DIR}/vibetunnel" "${APP_RESOURCES}/"
    chmod +x "${APP_RESOURCES}/vibetunnel"
else
    echo "error: vibetunnel executable not found"
    exit 1
fi

if [ -f "${NATIVE_DIR}/pty.node" ]; then
    cp "${NATIVE_DIR}/pty.node" "${APP_RESOURCES}/"
else
    echo "error: pty.node not found"
    exit 1
fi

if [ -f "${NATIVE_DIR}/spawn-helper" ]; then
    cp "${NATIVE_DIR}/spawn-helper" "${APP_RESOURCES}/"
    chmod +x "${APP_RESOURCES}/spawn-helper"
else
    echo "error: spawn-helper not found"
    exit 1
fi

echo "Web frontend build completed successfully"