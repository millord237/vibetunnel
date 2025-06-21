# VibeTunnel Codebase Map

A comprehensive navigation guide for the VibeTunnel web terminal system.

## Project Overview

VibeTunnel is a web-based terminal multiplexer with distributed architecture support. It provides:
- PTY-based terminal sessions via node-pty
- Real-time terminal streaming via SSE (asciinema cast files)
- Binary-optimized buffer synchronization (current viewport via WebSocket)
- Distributed HQ/remote server architecture
- Web UI with full terminal emulation

## Directory Structure

```
web/
├── src/
│   ├── server/           # Node.js Express server
│   │   ├── middleware/   # Auth and other middleware
│   │   ├── pty/         # PTY management
│   │   ├── routes/      # API endpoints
│   │   ├── services/    # Core services
│   │   ├── server.ts    # Server loader
│   │   └── fwd.ts       # CLI forwarding tool
│   ├── client/           # Lit-based web UI
│   │   ├── assets/      # Static files (fonts, icons, html)
│   │   ├── components/  # UI components
│   │   ├── services/    # Client services
│   │   └── utils/       # Client utilities
│   ├── test/            # Test files
│   └── index.ts         # Main entry point
├── scripts/             # Build scripts
└── public/              # Built static assets (generated)
```

## Server Architecture (`src/server/`)

### Core Components

#### Entry Points
- `index.ts` (1-25): Main entry point, chooses between server and forward modes
- `server/server.ts` (1-4): Simple loader for modular server
- `server/index.ts` (1-49): Server initialization, cleanup intervals, graceful shutdown
- `server/app.ts` (198-404): Express app factory, CLI parsing, mode configuration

#### Server Modes
1. **Normal Mode**: Standalone terminal server
2. **HQ Mode** (`--hq`): Central server managing remotes
3. **Remote Mode** (`--hq-url`): Registers with HQ server

### Authentication (`middleware/auth.ts`)
- Basic Auth: Username/password (46-55)
- Bearer Token: HQ↔Remote communication (28-44)
- Health endpoint bypass (14-16)

### Session Management

#### PTY Manager (`pty/pty-manager.ts`)
- `createSession()` (72-167): Spawns PTY processes
- `sendInput()` (265-315): Handles keyboard input
- `killSession()` (453-537): SIGTERM→SIGKILL escalation
- `resizeSession()` (394-447): Terminal dimension changes
- Control pipe support for external sessions (320-349)

#### Session Manager (`pty/session-manager.ts`)
- Session persistence in `~/.vibetunnel/control/`
- `listSessions()` (155-224): Filesystem-based discovery
- `updateZombieSessions()` (231-257): Dead process cleanup

#### Terminal Manager (`services/terminal-manager.ts`)
- Headless xterm.js for server-side state (40-69)
- `getBufferSnapshot()` (255-323): Captures terminal buffer
- `encodeSnapshot()` (328-555): Binary protocol encoding
- Debounced buffer notifications (627-642)

### API Routes (`routes/`)

#### Sessions (`sessions.ts`)
- `GET /api/sessions` (40-120): List with HQ aggregation
- `POST /api/sessions` (123-199): Create local/remote
- `DELETE /api/sessions/:id` (270-323): Kill session
- `GET /api/sessions/:id/stream` (517-627): SSE streaming of asciinema cast files
- `POST /api/sessions/:id/input` (630-695): Send input
- `POST /api/sessions/:id/resize` (698-767): Resize terminal
- `GET /api/sessions/:id/buffer` (455-514): Binary snapshot of current terminal view

#### Remotes (`remotes.ts`) - HQ Mode Only
- `GET /api/remotes` (15-27): List registered servers
- `POST /api/remotes/register` (30-52): Remote registration
- `DELETE /api/remotes/:id` (55-69): Unregister remote

### Binary Buffer Protocol

**Note**: "Buffer" refers to the current terminal display state (visible viewport) without scrollback history - just what's currently shown at the bottom of the terminal. This is used for rendering terminal previews in the session list.

#### Format (`terminal-manager.ts:361-555`)
```
Header (32 bytes):
- Magic: 0x5654 "VT" (2 bytes)
- Version: 0x01 (1 byte)
- Flags: reserved (1 byte)
- Dimensions: cols, rows (8 bytes)
- Cursor: X, Y, viewport (12 bytes)
- Reserved (4 bytes)

Rows: 0xFE=empty, 0xFD=content
Cells: Variable-length with type byte
```

### SSE Streaming and Asciinema Files

#### File Writing (`pty/asciinema-writer.ts`)
- **AsciinemaWriter** (separate file) writes cast files to `~/.vibetunnel/control/[sessionId]/stream-out`
- Used by PtyManager when creating sessions
- Records in asciinema v2 format with custom extensions:
  - Standard: `[timestamp, "o", output]` for terminal output
  - Standard: `[timestamp, "i", input]` for user input
  - Standard: `[timestamp, "r", "colsxrows"]` for resize events
  - **Custom**: `["exit", exitCode, sessionId]` when process terminates

#### SSE Streaming (`routes/sessions.ts:517-627`)
- Streams asciinema cast files from disk in real-time
- **StreamWatcher** monitors file changes and broadcasts to clients
- Replays existing content first (timestamps zeroed)
- Watches for new content and streams incrementally
- Closes connections on exit event

#### Client Playback (`client/utils/cast-converter.ts`)
- Parses asciinema v2 format
- Handles custom exit event to dispatch `session-exit`
- Supports batch loading and real-time streaming

### WebSocket (`services/buffer-aggregator.ts`)
- Client connections (31-68)
- Message handling (69-127)
- Local session buffers (131-195)
- Remote session proxy (200-232)
- Binary message format (136-164)

### HQ Mode Components

#### Remote Registry (`services/remote-registry.ts`)
- Health checks every 15s (118-146)
- Session ownership tracking (82-96)
- Bearer token authentication

#### HQ Client (`services/hq-client.ts`)
- Registration with HQ (29-58)
- Unregister on shutdown (60-72)

## Client Architecture (`src/client/`)

### Core Components

#### Entry Points
- `app-entry.ts` - Main application entry point
- `test-terminals-entry.ts` - Test terminals entry point
- `styles.css` - Global styles

#### Main Components
- `app.ts` - Lit-based SPA (15-331)
  - URL-based routing `?session=<id>`
  - Global keyboard handlers
  - Error/success message handling (74-90)

#### Terminal Components
- `terminal.ts` - Custom DOM terminal renderer (634-701)
  - Virtual scrolling (537-555)
  - Touch/momentum support
  - URL highlighting integration
  - Copy/paste handling
- `session-view.ts` - Full-screen terminal view (12-1331)
  - SSE streaming (275-333)
  - Mobile input overlays
  - Resize synchronization
- `vibe-terminal-buffer.ts` - Terminal buffer display component

#### UI Components
- `app-header.ts` - Application header
- `session-list.ts` - Active sessions list view
- `session-card.ts` - Individual session card
- `session-create-form.ts` - New session creation form
- `file-browser.ts` - File browser component
- `vibe-logo.ts` - Application logo
- `terminal-icon.ts` - Terminal icon
- `copy-icon.ts` - Copy icon

### Services

#### Buffer Subscription (`services/buffer-subscription-service.ts`)
- WebSocket client (30-87)
- Binary protocol decoder (163-208)
- Auto-reconnection with backoff

### Utils

#### Cast Converter (`utils/cast-converter.ts`)
- Asciinema v2 parser (31-82)
- SSE stream handler (294-427)
- Batch loading (221-283)

#### Terminal Renderer (`utils/terminal-renderer.ts`)
- Binary buffer decoder (279-424)
- HTML generation
- Style mapping

#### Additional Utilities
- `url-highlighter.ts` - URL detection and highlighting
- `xterm-colors.ts` - Terminal color definitions
- `terminal-preferences.ts` - Terminal preference management

## Forward Tool (`src/server/fwd.ts`)

### Purpose
CLI tool that spawns PTY sessions integrated with VibeTunnel infrastructure.

### Key Features
- Interactive terminal forwarding (295-312)
- Monitor-only mode (`--monitor-only`)
- Control pipe handling (140-287)
- Session persistence (439-446)

### Usage
```bash
npx tsx src/fwd.ts <command> [args...]
npx tsx src/fwd.ts --monitor-only <command>
```

### Integration Points
- Uses same PtyManager as server (63)
- Creates sessions in control directory
- Supports resize/kill via control pipe

## Key Files Quick Reference

### Server Core
- `src/index.ts`: Main entry point
- `src/server/server.ts`: Server loader
- `src/server/app.ts`: App configuration, CLI parsing
- `src/server/middleware/auth.ts`: Authentication logic
- `src/server/routes/sessions.ts`: Session API endpoints
- `src/server/pty/pty-manager.ts`: PTY process management
- `src/server/pty/asciinema-writer.ts`: Cast file writer
- `src/server/services/terminal-manager.ts`: Terminal state & binary protocol
- `src/server/services/buffer-aggregator.ts`: WebSocket buffer distribution
- `src/server/services/stream-watcher.ts`: SSE file streaming
- `src/server/fwd.ts`: CLI forwarding tool

### Client Core
- `src/client/app-entry.ts`: Application entry point
- `src/client/app.ts`: Main SPA component
- `src/client/components/terminal.ts`: Terminal renderer
- `src/client/components/session-view.ts`: Session viewer
- `src/client/components/session-list.ts`: Session list view
- `src/client/services/buffer-subscription-service.ts`: WebSocket client
- `src/client/utils/cast-converter.ts`: Asciinema parser
- `src/client/assets/`: Static files (fonts, icons, HTML)

### Configuration
- Environment: `PORT`, `VIBETUNNEL_USERNAME`, `VIBETUNNEL_PASSWORD`
- CLI: `--port`, `--username`, `--password`, `--hq`, `--hq-url`, `--name`

### Protocols
- REST API: Session CRUD, terminal I/O
- SSE: Real-time streaming of asciinema cast files from disk
- WebSocket: Binary buffer updates (current terminal viewport)
- Control pipes: External session control

## Development Notes

### Build System
- `npm run dev`: Auto-rebuilds TypeScript
- `npm run build`: Full build including Node.js SEA executable
- ESBuild: Fast bundling
- Node.js SEA: Creates standalone executable (Node.js 20+ required)
- Vitest: Testing framework
- Assets: Copied from `src/client/assets/` to `public/` during build

### Testing
- Unit tests: `npm test`
- E2E tests: `npm run test:e2e`
- Integration: `npm run test:integration`

### Key Dependencies
- node-pty: Cross-platform PTY
- @xterm/headless: Terminal emulation
- Lit: Web components
- Express: HTTP server
- TailwindCSS: Styling