#!/bin/zsh
# Build web frontend using npm
echo "Building web frontend..."

# Get the project directory
PROJECT_DIR="${SRCROOT}"
WEB_DIR="${PROJECT_DIR}/../web"
PUBLIC_DIR="${WEB_DIR}/public"
DEST_DIR="${BUILT_PRODUCTS_DIR}/${CONTENTS_FOLDER_PATH}/Resources/web/public"
BUILD_TOOLS_DIR="${PROJECT_DIR}/.build-tools"

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

# Node Version Manager (n)
if [ -d "/usr/local/n/versions" ]; then
    export PATH="/usr/local/bin:$PATH"
fi

# MacPorts
if [ -d "/opt/local/bin" ]; then
    export PATH="/opt/local/bin:$PATH"
fi

# Export CI environment variable to prevent interactive prompts
export CI=true

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo "error: npm could not be found in PATH"
    echo "PATH is: $PATH"
    echo "Please ensure Node.js and npm are installed"
    exit 1
fi

# Print npm version for debugging
echo "Using npm version: $(npm --version)"
echo "Using Node.js version: $(node --version)"
echo "PATH: $PATH"

# Check if web directory exists
if [ ! -d "${WEB_DIR}" ]; then
    echo "error: Web directory not found at ${WEB_DIR}"
    exit 1
fi

# Change to web directory
cd "${WEB_DIR}"

# Install dependencies
echo "Installing dependencies with npm..."
npm install
if [ $? -ne 0 ]; then
    echo "error: npm install failed"
    exit 1
fi

# Clean up any existing output.css directory/file conflicts
if [ -d "public/output.css" ]; then
    rm -rf "public/output.css"
fi

# Build the web frontend
echo "Running npm build..."
npm run build
if [ $? -ne 0 ]; then
    echo "error: npm run build failed"
    exit 1
fi

# Create destination directory
mkdir -p "${DEST_DIR}"

# Clean destination directory to avoid stale files
echo "Cleaning destination directory..."
rm -rf "${DEST_DIR}/"*

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