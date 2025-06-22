#!/bin/zsh
set -e  # Exit on any error

# Get the project directory
if [ -z "${SRCROOT}" ]; then
    # If SRCROOT is not set (running outside Xcode), determine it from script location
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
else
    PROJECT_DIR="${SRCROOT}"
fi

WEB_DIR="${PROJECT_DIR}/../web"
HASH_FILE="${BUILT_PRODUCTS_DIR}/.web-content-hash"
PREVIOUS_HASH_FILE="${BUILT_PRODUCTS_DIR}/.web-content-hash.previous"
PUBLIC_DIR="${WEB_DIR}/public"

# Set destination directory
if [ -z "${BUILT_PRODUCTS_DIR}" ]; then
    # Default for testing outside Xcode
    DEST_DIR="/tmp/vibetunnel-web-build"
else
    DEST_DIR="${BUILT_PRODUCTS_DIR}/${CONTENTS_FOLDER_PATH}/Resources/web/public"
fi

APP_RESOURCES="${BUILT_PRODUCTS_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}"

# Read the current hash
if [ -f "${HASH_FILE}" ]; then
    CURRENT_HASH=$(cat "${HASH_FILE}")
else
    echo "error: Hash file not found. Run 'Calculate Web Hash' build phase first."
    exit 1
fi

# Check if we need to rebuild
NEED_REBUILD=1

# Check if previous hash exists and matches current
if [ -f "${PREVIOUS_HASH_FILE}" ]; then
    PREVIOUS_HASH=$(cat "${PREVIOUS_HASH_FILE}")
    if [ "${CURRENT_HASH}" = "${PREVIOUS_HASH}" ]; then
        # Also check if the built files actually exist
        if [ -d "${DEST_DIR}" ] && [ -f "${APP_RESOURCES}/vibetunnel" ] && [ -f "${APP_RESOURCES}/pty.node" ] && [ -f "${APP_RESOURCES}/spawn-helper" ]; then
            echo "Web content unchanged and build outputs exist. Skipping rebuild."
            NEED_REBUILD=0
        else
            echo "Web content unchanged but build outputs missing. Rebuilding..."
        fi
    else
        echo "Web content changed. Hash: ${PREVIOUS_HASH} -> ${CURRENT_HASH}"
    fi
else
    echo "No previous build hash found. Building web frontend..."
fi

if [ ${NEED_REBUILD} -eq 0 ]; then
    echo "Skipping web frontend build (no changes detected)"
    exit 0
fi

echo "Building web frontend..."

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

# Save the current hash as the previous hash for next build
cp "${HASH_FILE}" "${PREVIOUS_HASH_FILE}"

echo "Web frontend build completed successfully"