# Node.js Server Support for VibeTunnel Mac App

This document describes the implementation of optional Node.js server support in the VibeTunnel Mac app, following Option A from the architecture plan.

## Overview

The Mac app now supports both Go (default) and Node.js servers with runtime switching capability. Users can choose between:
- **Go Server**: Fast, native implementation with minimal resource usage (default)
- **Node.js Server**: Original implementation with full feature compatibility

## Architecture

### Server Abstraction

A protocol-based abstraction (`VibeTunnelServer`) allows seamless switching between server implementations:

```swift
@MainActor
protocol VibeTunnelServer: AnyObject {
    var isRunning: Bool { get }
    var port: String { get set }
    var bindAddress: String { get set }
    var logStream: AsyncStream<ServerLogEntry> { get }
    var serverType: ServerType { get }
    
    func start() async throws
    func stop() async
    func checkHealth() async -> Bool
    func getStaticFilesPath() -> String?
    func cleanup() async
}
```

### Implementation Files

- `mac/VibeTunnel/Core/Protocols/VibeTunnelServer.swift` - Server protocol definition
- `mac/VibeTunnel/Core/Services/GoServer.swift` - Go server implementation (updated)
- `mac/VibeTunnel/Core/Services/NodeServer.swift` - Node.js server implementation (new)
- `mac/VibeTunnel/Core/Services/ServerManager.swift` - Updated to support multiple server types

### UI Integration

The server type selection is available in Settings > Advanced:
- `mac/VibeTunnel/Presentation/Views/Settings/AdvancedSettingsView.swift` - Added ServerTypeSection

## Build Process

### Building with Node.js Support

To build the app with Node.js server support (recommended):

```bash
# Build with Node.js server included (default recommendation)
BUILD_NODE_SERVER=true ./mac/Scripts/build.sh

# Or build just the Node.js components
./mac/Scripts/build-node-server.sh
./mac/Scripts/download-node.sh
```

**Note**: Building with BUILD_NODE_SERVER=true is the recommended approach to ensure full compatibility with both server implementations.

### Scripts

1. **build-node-server.sh** - Creates the Node.js server bundle
   - Compiles TypeScript server code
   - Installs production dependencies
   - Creates minimal package.json
   - Bundles in Resources/node-server/

2. **download-node.sh** - Downloads and prepares Node.js runtime
   - Downloads official Node.js binaries for both architectures
   - Creates universal binary using lipo
   - Caches downloads for faster rebuilds
   - Signs the binary for macOS

## Distribution Structure

When built with Node.js support:

```
VibeTunnel.app/
├── Contents/
│   ├── MacOS/
│   │   └── VibeTunnel
│   ├── Resources/
│   │   ├── vibetunnel         # Go binary (current)
│   │   ├── node/              # Node.js runtime (optional)
│   │   │   └── node           # Universal binary
│   │   ├── node-server/       # Node.js server (optional)
│   │   │   ├── dist/          # Compiled server code
│   │   │   ├── node_modules/  # Production dependencies
│   │   │   ├── public/        # Static files
│   │   │   └── package.json
│   │   └── web/               # Static files for Go server

```

## Usage

### For Users

1. Open VibeTunnel Settings
2. Navigate to Advanced tab
3. Find "Server Implementation" section
4. Choose between "Go (Native)" or "Node.js"
5. The app will restart the server with the selected implementation

### For Developers

To test server switching:

```swift
// Programmatically switch server type
ServerManager.shared.serverType = .node

// The server will automatically restart with the new type
```

## Size Impact

- Base app with Go server only: ~15MB
- With Node.js runtime: +50MB
- With Node.js server bundle: +20MB
- Total with full Node.js support: ~85MB

## Future Improvements

1. **Separate Download Option**: Instead of bundling Node.js support, provide an in-app download option to reduce initial app size

2. **Feature Detection**: Automatically suggest Node.js server for features not available in Go implementation

3. **Performance Metrics**: Show comparative metrics between server implementations

## Testing

To test the implementation:

1. Build with `BUILD_NODE_SERVER=true`
2. Launch the app
3. Go to Settings > Advanced
4. Switch between server types
5. Verify server starts and sessions work correctly

## Known Limitations

1. Node.js server requires more memory and CPU than Go server
2. Native module dependencies (node-pty) must be compatible with bundled Node.js version
3. Server switching requires stopping all active sessions

## Troubleshooting

### Node.js server not available in settings
- Ensure app was built with `BUILD_NODE_SERVER=true`
- Check that Resources/node-server directory exists in app bundle

### Node.js server fails to start
- Check Console.app for detailed error messages
- Verify Node.js runtime is properly signed
- Ensure node-pty native module is compatible

### Performance issues with Node.js server
- This is expected; Node.js has higher resource usage
- Consider switching back to Go server for better performance