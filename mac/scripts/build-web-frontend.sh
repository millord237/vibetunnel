#!/bin/zsh
# Build web frontend using Bun
echo "Building web frontend..."

# Get the project directory
PROJECT_DIR="${SRCROOT}"
WEB_DIR="${PROJECT_DIR}/../web"
PUBLIC_DIR="${WEB_DIR}/public"
DEST_DIR="${BUILT_PRODUCTS_DIR}/${CONTENTS_FOLDER_PATH}/Resources/web/public"
BUILD_TOOLS_DIR="${PROJECT_DIR}/.build-tools"

# Add local Bun to PATH if it exists
if [ -d "${PROJECT_DIR}/.build-tools/bun/bin" ]; then
    export PATH="${PROJECT_DIR}/.build-tools/bun/bin:$PATH"
fi

# Add system Bun to PATH if available
if [ -d "$HOME/.bun/bin" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
fi

# Export CI environment variable to prevent interactive prompts
export CI=true

# Check if Bun is available
if ! command -v bun &> /dev/null; then
    echo "error: Bun could not be found in PATH"
    echo "PATH is: $PATH"
    echo "Please run install-bun.sh or ensure Bun is installed"
    exit 1
fi

# Print Bun version for debugging
echo "Using Bun version: $(bun --version)"
echo "PATH: $PATH"

# Check if web directory exists
if [ ! -d "${WEB_DIR}" ]; then
    echo "error: Web directory not found at ${WEB_DIR}"
    exit 1
fi

# Change to web directory
cd "${WEB_DIR}"

# Install dependencies
echo "Installing dependencies with Bun..."
bun install --no-progress
if [ $? -ne 0 ]; then
    echo "error: bun install failed"
    exit 1
fi

# Clean up any existing output.css directory/file conflicts
if [ -d "public/output.css" ]; then
    rm -rf "public/output.css"
fi

# Build the web frontend
echo "Running bun bundle..."
bun run bundle
if [ $? -ne 0 ]; then
    echo "error: bun run bundle failed"
    exit 1
fi

# Create destination directory
mkdir -p "${DEST_DIR}"

# Copy built files to Resources
echo "Copying web files to app bundle..."
if [ -d "${PUBLIC_DIR}" ]; then
    # Copy all files from public directory
    cp -R "${PUBLIC_DIR}/"* "${DEST_DIR}/"
    echo "Web frontend files copied to ${DEST_DIR}"
else
    echo "error: Public directory not found at ${PUBLIC_DIR}"
    exit 1
fi