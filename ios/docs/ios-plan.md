# iOS App Update Plan

This document outlines the comprehensive plan to update the VibeTunnel iOS app to match all features available in the JavaScript front-end.

## Analysis Summary

The iOS app is well-architected but missing several key features and has critical API communication issues that prevent it from working properly with the current server implementation.

## Feature Comparison: JavaScript vs iOS

### ✅ Features Present in Both
1. Session management (list, create, kill, cleanup)
2. Terminal display and input
3. WebSocket binary buffer streaming
4. File browser with git integration
5. Terminal resizing
6. Font size adjustment
7. Connection management
8. Error handling and reconnection
9. Mobile-specific controls (arrow keys, special keys)

### ❌ Missing in iOS App

1. **SSE Text Streaming** (`/api/sessions/:id/stream`)
   - JS uses SSE for real-time text output as primary method
   - iOS only uses binary WebSocket, no SSE implementation active

2. **File Preview with Syntax Highlighting**
   - JS has CodeMirror integration for code preview
   - iOS only has basic text viewing

3. **Git Diff Viewer**
   - JS: `/api/fs/diff?path=...` endpoint for viewing diffs
   - iOS: No diff viewing capability

4. **System Logs Viewer**
   - JS: Full logs viewer with filtering, search, download
   - iOS: No logs access

5. **Hot Reload Support**
   - JS: Development hot reload via WebSocket
   - iOS: Not applicable but no equivalent dev mode

6. **Cast File Import/Playback**
   - JS: Can import and play external cast files
   - iOS: Only records, no import capability

7. **URL Detection in Terminal**
   - JS: Clickable URLs in terminal output
   - iOS: No URL detection

8. **Session Name in Creation**
   - JS: Supports custom session names
   - iOS: Has UI but may not send to server

### 🔄 Different Implementations

1. **Terminal Rendering**
   - JS: Custom renderer with xterm.js (headless)
   - iOS: SwiftTerm library

2. **State Management**
   - JS: Local storage for preferences
   - iOS: UserDefaults + @Observable

3. **Terminal Controls**
   - JS: Ctrl key grid popup
   - iOS: Toolbar with common keys

4. **File Path Insertion**
   - JS: Direct insertion into terminal
   - iOS: Copy to clipboard only

### 🔧 API Endpoint Differences

1. **Missing Endpoints in iOS**:
   - `GET /api/fs/preview` - File preview
   - `GET /api/fs/diff` - Git diffs
   - `GET /api/logs/raw` - System logs
   - `GET /api/logs/info` - Log metadata
   - `DELETE /api/logs/clear` - Clear logs

2. **Different Endpoint Usage**:
   - iOS uses `/api/cleanup-exited` vs JS uses `DELETE /api/sessions`
   - iOS has `/api/mkdir` which JS doesn't use

## Implementation Plan

### Phase 1: Critical Server Communication Fixes 🚨

1. **Fix Session Creation API**
   - Update `APIClient.createSession()` to match JS payload:
     - Add `spawn_terminal: true` field (currently missing!)
     - Ensure `cols` and `rows` are sent
     - Verify `name` field is included
   - File: `ios/VibeTunnel/Services/APIClient.swift`

2. **Implement SSE Text Streaming**
   - Add SSEClient implementation for `/api/sessions/:id/stream`
   - Handle event parsing: `[timestamp, type, data]` format
   - Process exit events: `['exit', exitCode, sessionId]`
   - Integrate with TerminalView as alternative to WebSocket
   - Files: Create `ios/VibeTunnel/Services/SSEClient.swift`

3. **Fix Binary WebSocket Protocol**
   - Verify magic byte handling (0xBF)
   - Ensure proper session ID encoding in binary messages
   - Handle all message types: connected, subscribed, ping/pong, error
   - File: `ios/VibeTunnel/Services/BufferWebSocketClient.swift`

### Phase 2: Essential Missing Features 🔧

4. **Add File Preview with Syntax Highlighting**
   - Implement `/api/fs/preview` endpoint call
   - Add syntax highlighting library (Highlightr or similar)
   - Support text/image/binary preview types
   - Files: Update `APIClient.swift`, create `FilePreviewView.swift`

5. **Add Git Diff Viewer**
   - Implement `/api/fs/diff` endpoint
   - Create diff viewer UI component
   - Integrate with file browser
   - Files: Update `APIClient.swift`, create `GitDiffView.swift`

6. **Fix Session Cleanup Endpoint**
   - Change from `/api/cleanup-exited` to `DELETE /api/sessions`
   - Update to match JS implementation
   - File: `ios/VibeTunnel/Services/APIClient.swift`

### Phase 3: Enhanced Features ✨

7. **Add System Logs Viewer**
   - Implement logs endpoints: `/api/logs/raw`, `/api/logs/info`
   - Create logs viewer with filtering and search
   - Add download capability
   - Files: Create `LogsView.swift`, update `APIClient.swift`

8. **Improve Terminal Features**
   - Add URL detection and clickable links
   - Implement selection-based copy (not just copy-all)
   - Add terminal search functionality
   - File: `ios/VibeTunnel/Views/Terminal/TerminalView.swift`

9. **Add Cast File Import**
   - Implement cast file parser
   - Add import from Files app
   - Create playback from imported files
   - Files: Update `CastPlayerView.swift`, `CastRecorder.swift`

### Phase 4: UI/UX Improvements 💫

10. **File Browser Enhancements**
    - Add file upload capability
    - Implement direct path insertion to terminal
    - Add multi-select for batch operations
    - File: `ios/VibeTunnel/Views/FileBrowser/FileBrowserView.swift`

11. **Session Management**
    - Add session renaming capability
    - Implement session tags/categories
    - Add session history/favorites
    - File: `ios/VibeTunnel/Views/Sessions/SessionListView.swift`

### Phase 5: iPad Optimizations 📱

12. **iPad-Specific Features**
    - Implement split view support
    - Add keyboard shortcuts
    - Optimize for larger screens
    - Support multiple concurrent sessions view

## Implementation Priority

1. **Immediate (Phase 1)**: Fix session creation and server communication
2. **High (Phase 2)**: Add file preview, git diff, fix endpoints
3. **Medium (Phase 3)**: Logs viewer, terminal improvements, cast import
4. **Low (Phase 4-5)**: UI enhancements, iPad optimizations

## Testing Checklist

- [ ] Create new sessions with various commands
- [ ] Verify terminal output appears correctly
- [ ] Test terminal input and special keys
- [ ] Confirm WebSocket reconnection works
- [ ] Test file browser and preview
- [ ] Verify git integration features
- [ ] Test session management operations
- [ ] Check error handling and offline mode

## JavaScript Front-End Features (Complete List)

### 1. Session Management
- Session list with live updates (3-second polling)
- Create sessions with custom commands and working directories
- Kill individual sessions or all at once
- Cleanup exited sessions
- Session status tracking (running, exited, waiting)
- Session filtering and search

### 2. Terminal I/O and Display
- Real-time terminal output via SSE and WebSocket
- Full keyboard input with special keys
- Dynamic terminal resizing
- Copy/paste support
- Scroll control with auto-scroll
- Font size control (8-32px)
- Width control and fit-to-width mode
- Mobile input support with on-screen keyboard

### 3. Binary Terminal Buffer Streaming
- WebSocket connection for efficient updates
- Binary protocol with magic bytes
- Auto-reconnection with exponential backoff
- Buffer synchronization
- Content change detection

### 4. File Browser
- Directory navigation with git integration
- File preview with syntax highlighting (CodeMirror)
- Image preview
- Git status display and diff viewer
- File filtering by git status
- Path insertion into terminal

### 5. System Logs Viewer
- Real-time log display (2-second refresh)
- Filter by log level and source
- Text search
- Auto-scroll toggle
- Log download and clearing

### 6. Additional Features
- Hot reload for development
- Local storage for preferences
- URL routing with session state
- Error notifications with auto-dismiss
- Cast file support (playback and conversion)
- ANSI color support (256 colors and true color)
- URL detection in terminal output
- Performance optimizations (batched rendering)

## API Endpoints Reference

### Session Management
- `GET /api/sessions` - List all sessions
- `POST /api/sessions` - Create new session
- `DELETE /api/sessions/:id` - Kill session
- `DELETE /api/sessions` - Cleanup all exited sessions
- `POST /api/sessions/:id/input` - Send input
- `POST /api/sessions/:id/resize` - Resize terminal
- `GET /api/sessions/:id/snapshot` - Get terminal snapshot
- `GET /api/sessions/:id/stream` - SSE stream for output

### File System
- `GET /api/fs/browse?path=...&showHidden=...&gitFilter=...` - Browse directories
- `GET /api/fs/preview?path=...` - Preview file content
- `GET /api/fs/diff?path=...` - Get git diff

### System
- `GET /api/logs/raw` - Get raw logs
- `GET /api/logs/info` - Get log metadata
- `DELETE /api/logs/clear` - Clear logs
- `GET /api/health` - Health check

### WebSocket
- `ws://server/buffers` - Binary terminal buffer streaming
- `ws://server/?hotReload=true` - Development hot reload