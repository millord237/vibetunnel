# Tauri App Node.js Subprocess Architecture

## Overview

The VibeTunnel Tauri app has been redesigned to use a subprocess architecture that matches the Mac app's approach. Instead of embedding terminal management in Rust, the app spawns the same `vibetunnel` Node.js executable used by the Mac app.

## Architecture Components

### 1. Backend Manager (`backend_manager.rs`)
- **Purpose**: Manages the lifecycle of the Node.js subprocess
- **Key Features**:
  - Spawns `vibetunnel` executable with proper arguments
  - Monitors process health and handles crashes
  - Implements exponential backoff for crash recovery (2, 4, 8, 16, 32 seconds)
  - Platform-specific signal handling (SIGTERM on Unix, kill on Windows)
  - Authentication credential management from settings

### 2. API Client (`api_client.rs`)
- **Purpose**: HTTP client for communicating with the Node.js server
- **Endpoints Implemented**:
  - `POST /api/sessions` - Create terminal session
  - `GET /api/sessions` - List sessions
  - `DELETE /api/sessions/:id` - Close session
  - `POST /api/sessions/:id/input` - Send terminal input
  - `POST /api/sessions/:id/resize` - Resize terminal
  - `GET /api/sessions/:id/buffer` - Get terminal output

### 3. Resource Management
- **Bundled Resources**:
  - `vibetunnel` - Node.js standalone executable
  - `pty.node` - Native module for terminal emulation
  - `spawn-helper` - Unix helper for process spawning
  - `web/public/**/*` - Static web assets

## Key Changes from Embedded Server

### Before (Rust Terminal Management)
```
Tauri App
├── Rust HTTP Server (Axum)
├── Rust Terminal Manager (portable-pty)
└── Direct PTY management
```

### After (Node.js Subprocess)
```
Tauri App
├── Backend Manager (subprocess spawner)
├── API Client (HTTP proxy)
└── Node.js Server (subprocess)
    ├── Express HTTP Server
    ├── Node-pty terminal management
    └── WebSocket/SSE streaming
```

## Benefits

1. **Code Reuse**: Uses the exact same server implementation as the Mac app
2. **Consistency**: Identical terminal behavior across all platforms
3. **Maintainability**: Single codebase for terminal operations
4. **Stability**: Process isolation prevents crashes from affecting the main app
5. **Features**: All Mac app features available (HQ mode, authentication, etc.)

## Implementation Details

### Process Spawning
```rust
// Spawn vibetunnel with arguments
let mut cmd = Command::new(&exe_path);
cmd.args(&["--port", "4020"])
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true);
```

### Crash Recovery
- Monitors process exit status
- Implements exponential backoff: 2^n seconds (max 5 retries)
- Resets crash counter on successful restart
- Can be disabled via `set_crash_recovery_enabled(false)`

### Authentication
- Reads dashboard password from settings
- Passes credentials via command line arguments
- Supports same authentication as Mac app

### Port Configuration
- Reads port from settings on startup
- Supports dynamic port changes via `restart_server_with_port`
- Updates both backend manager and server on port change

## Platform Considerations

### Windows
- Uses `.exe` extension for executable
- Handles process termination via `kill()`
- No spawn-helper required

### Unix (Linux/macOS)
- Uses SIGTERM for graceful shutdown
- Requires spawn-helper for PTY operations
- Sets executable permissions (0o755)

## Development Workflow

1. Build Node.js server: `cd ../web && npm run build`
2. Run Tauri dev: `./dev.sh` or `cargo tauri dev`
3. Production build: `./build.sh` or `cargo tauri build`

## Troubleshooting

### Server Won't Start
- Check if vibetunnel executable exists in resources
- Verify port is not already in use
- Check executable permissions on Unix

### Terminal Commands Fail
- Ensure server is running (check status)
- Verify API client can reach localhost:port
- Check authentication if password enabled

### Crash Recovery Not Working
- Check logs for exit codes
- Verify crash recovery is enabled
- Look for port binding issues (exit code 9)

## Future Improvements

1. **Dynamic API Client**: Create new API client instance on port change
2. **Health Monitoring**: Periodic health checks like Mac app
3. **Binary Protocol**: Implement WebSocket binary buffer streaming
4. **Hot Reload**: Support server updates without app restart