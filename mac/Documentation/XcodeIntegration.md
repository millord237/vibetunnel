# Xcode Integration for Node.js Server Support

This document describes how the Node.js server support has been integrated into the VibeTunnel Xcode project.

## Integration Summary

The Node.js server support has been fully integrated into the Xcode project with the following components:

### 1. Swift Files (Automatically Synchronized)

Since the project uses Xcode's file system synchronization (objectVersion = 77), the following files are automatically included:
- `VibeTunnelServer.swift` - Protocol defining server interface
- `NodeServer.swift` - Node.js server implementation
- `GoServer.swift` - Updated to conform to the protocol
- `ServerManager.swift` - Updated to support multiple server types
- `AdvancedSettingsView.swift` - Updated with server type selection UI

### 2. Build Phases Added

Two new build phases were added to the VibeTunnel target:

#### Download Node.js Runtime
- **Position**: After "Build Go vibetunnel Universal Binary"
- **Purpose**: Downloads and prepares Node.js runtime when `BUILD_NODE_SERVER=true`
- **Script**: Calls `Scripts/download-node.sh`
- **Output**: `$(BUILT_PRODUCTS_DIR)/$(CONTENTS_FOLDER_PATH)/Resources/node`

#### Build Node.js Server Bundle
- **Position**: After "Download Node.js Runtime"
- **Purpose**: Builds the Node.js server bundle when `BUILD_NODE_SERVER=true`
- **Script**: Calls `Scripts/build-node-server.sh`
- **Inputs**:
  - `$(SRCROOT)/../web/src/server.ts`
  - `$(SRCROOT)/../web/src/server`
  - `$(SRCROOT)/../web/package.json`
  - `$(SRCROOT)/Scripts/build-node-server.sh`
- **Output**: `$(BUILT_PRODUCTS_DIR)/$(CONTENTS_FOLDER_PATH)/Resources/node-server`

### 3. Build Scripts

The following scripts were created:
- `Scripts/build-node-server.sh` - Builds the Node.js server bundle
- `Scripts/download-node.sh` - Downloads and caches Node.js runtime
- `Scripts/add-nodejs-build-phases.rb` - Adds build phases to Xcode project (one-time use)

### 4. Build Configuration

The Node.js support is optional and controlled by the `BUILD_NODE_SERVER` environment variable:

```bash
# Build without Node.js support (default)
xcodebuild -workspace VibeTunnel.xcworkspace -scheme VibeTunnel build

# Build with Node.js support
BUILD_NODE_SERVER=true xcodebuild -workspace VibeTunnel.xcworkspace -scheme VibeTunnel build
```

## Building in Xcode

To build with Node.js support in Xcode:

1. Open the scheme editor (Product > Scheme > Edit Scheme...)
2. Select the "Run" action
3. Go to the "Arguments" tab
4. Add environment variable: `BUILD_NODE_SERVER` = `true`
5. Build the project normally

## Project Structure

The integration maintains a clean separation:
- Go server remains the default implementation
- Node.js support is completely optional
- Build phases check for `BUILD_NODE_SERVER` before executing
- No impact on build time when Node.js support is disabled

## Testing the Integration

1. Build normally to verify Go-only build works
2. Build with `BUILD_NODE_SERVER=true` to include Node.js support
3. Run the app and check Settings > Advanced for server type selection
4. Switch between Go and Node.js servers to verify functionality

## Maintenance

- The Xcode project file automatically syncs with file system changes
- Build phases are configured to always run (alwaysOutOfDate = 1) but check BUILD_NODE_SERVER internally
- Scripts are self-contained and handle their own error checking

## Known Issues

- First build with Node.js support will be slower due to downloads
- Node.js runtime is cached in `~/.vibetunnel/cache` to speed up subsequent builds
- The app size increases by ~70MB when Node.js support is included