# VibeTunnel Codebase Map

A comprehensive navigation guide for the VibeTunnel web terminal system.

## Project Overview

VibeTunnel is a web-based terminal multiplexer with distributed architecture support. It provides:
- PTY-based terminal sessions via node-pty
- Real-time terminal streaming via SSE (asciinema cast files)
- Binary-optimized buffer synchronization (current viewport via WebSocket)
- Distributed HQ/remote server architecture
- Web UI with full terminal emulation
- Push notifications for terminal bell events
- Multi-method authentication (SSH keys, JWT, PAM)

## Directory Structure

```
web/
├── src/
│   ├── server/           # Node.js Express server
│   │   ├── middleware/   # Auth and other middleware
│   │   ├── pty/         # PTY management
│   │   ├── routes/      # API endpoints
│   │   ├── services/    # Core services
│   │   ├── server.ts    # Main server implementation
│   │   └── fwd.ts       # CLI forwarding tool
│   ├── client/           # Lit-based web UI
│   │   ├── assets/      # Static files (fonts, icons, html)
│   │   ├── components/  # UI components
│   │   ├── services/    # Client services
│   │   └── utils/       # Client utilities
│   ├── test/            # Test files
│   └── cli.ts           # Main entry point
├── scripts/             # Build scripts
└── public/              # Built static assets (generated)
```

## Server Architecture (`src/server/`)

### Core Components

#### Entry Points
- `cli.ts` (1-62): Main entry point, routes to server or forward mode
- `server/server.ts` (1-953): Core server implementation with Express app factory
  - CLI parsing (132-236): Extensive configuration options
  - Server modes (432-444): Normal, HQ, Remote initialization
  - WebSocket upgrade (564-677): Authentication and buffer streaming
  - Graceful shutdown (888-944): Cleanup intervals and service termination

### Authentication (`middleware/auth.ts`)
- Multi-method authentication (1-159)
  - SSH key authentication with Ed25519 support
  - Basic auth (username/password)
  - Bearer token for HQ↔Remote communication
  - JWT tokens for session persistence
- Local bypass for localhost connections (24-48, 68-87)
- Query parameter token support for EventSource

### Session Management

#### PTY Manager (`pty/pty-manager.ts`)
- Session creation (78-163): Spawns PTY processes with node-pty
- **Automatic alias resolution** (191-204): Uses `ProcessUtils.resolveCommand()`
- Terminal resize handling (63-157): Dimension synchronization
- Control pipe support using file watching on all platforms
- Bell event emission for push notifications
- Clean termination with SIGTERM→SIGKILL escalation

#### Process Utils (`pty/process-utils.ts`)
- `resolveCommand()` (242-378): Detects if command exists in PATH
  - Uses `which` (Unix) or `where` (Windows) to check existence
  - Returns appropriate shell command for aliases/builtins
  - Sources shell config files for proper alias support
- `getUserShell()` (384-484): Determines user's preferred shell
  - Checks `$SHELL` environment variable first
  - Platform-specific fallbacks (pwsh/cmd on Windows, zsh/bash on Unix)
- Interactive shell detection (220-235): Auto-adds `-i -l` flags

#### Session Manager (`pty/session-manager.ts`)
- Session persistence in `~/.vibetunnel/control/`
- Filesystem-based session discovery
- Zombie session cleanup

#### Terminal Manager (`services/terminal-manager.ts`)
- Headless xterm.js for server-side state
- Binary buffer snapshot generation
- Watches asciinema cast files and applies to terminal
- Debounced buffer change notifications

### API Routes (`routes/`)

#### Sessions (`sessions.ts`)
- `GET /api/sessions` (51-124): List all sessions
  - Returns array with `source: 'local' | 'remote'`
  - HQ mode: Aggregates from all remote servers
- `POST /api/sessions` (126-265): Create session
  - Body: `{ command, workingDir?, name?, remoteId?, spawn_terminal? }`
  - Returns: `{ sessionId: string, message?: string }`
- `GET /api/sessions/:id` (369-410): Get session info
- `DELETE /api/sessions/:id` (413-467): Kill session
- `DELETE /api/sessions/:id/cleanup` (470-518): Clean session files
- `POST /api/cleanup-exited` (521-598): Clean all exited sessions

#### Session I/O
- `POST /api/sessions/:id/input` (874-950): Send keyboard input
  - Body: `{ text: string }` OR `{ key: SpecialKey }`
- `POST /api/sessions/:id/resize` (953-1025): Resize terminal
  - Body: `{ cols: number, rows: number }`
- `POST /api/sessions/:id/reset-size` (1028-1083): Reset to native size

#### Session Output
- `GET /api/sessions/:id/stream` (723-871): SSE streaming
  - Streams asciinema v2 format with custom exit event
  - Replays existing content, then real-time streaming
- `GET /api/sessions/:id/buffer` (662-721): Binary buffer snapshot
- `GET /api/sessions/:id/text` (601-659): Plain text output
  - Optional `?styles` for markup: `[style fg="15" bold]text[/style]`

#### Activity Monitoring
- `GET /api/sessions/activity` (268-324): All sessions activity
- `GET /api/sessions/:id/activity` (327-366): Single session activity
  - Returns: `{ isActive: boolean, timestamp: string, session: SessionInfo }`

#### Remotes (`remotes.ts`) - HQ Mode Only
- `GET /api/remotes` (19-33): List registered servers
- `POST /api/remotes/register` (36-64): Register remote
- `DELETE /api/remotes/:id` (67-84): Unregister remote
- `POST /api/remotes/:id/refresh-sessions` (87-152): Refresh session list

#### Logs (`logs.ts`)
- `POST /api/logs/client` (21-53): Client log submission
- `GET /api/logs/raw` (56-74): Stream raw log file
- `GET /api/logs/info` (77-102): Log file metadata
- `DELETE /api/logs/clear` (105-119): Clear log file

### Binary Buffer Protocol

**Note**: "Buffer" refers to the current terminal viewport without scrollback - used for terminal previews.

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

#### Asciinema Writer (`pty/asciinema-writer.ts`)
- Writes cast files to `~/.vibetunnel/control/[sessionId]/stream-out`
- Format:
  - Standard: `[timestamp, "o", output]` for terminal output
  - Standard: `[timestamp, "i", input]` for user input
  - Standard: `[timestamp, "r", "colsxrows"]` for resize events
  - **Custom**: `["exit", exitCode, sessionId]` when process terminates

#### SSE Streaming (`routes/sessions.ts:723-871`)
- Real-time streaming of asciinema cast files
- Replays existing content with zeroed timestamps
- Watches for new content and streams incrementally
- Heartbeat every 30 seconds

### WebSocket (`services/buffer-aggregator.ts`)
- Client connections (30-87): Authentication and subscription
- Message handling (88-127): Subscribe/unsubscribe/ping
- Binary protocol (156-209): `[0xBF][ID Length][Session ID][Buffer Data]`
- Local and remote session proxy support

### Activity Monitoring (`services/activity-monitor.ts`)
- Monitors `stream-out` file size changes (143-146)
- 100ms check interval (41-44)
- 500ms inactivity timeout (209-212)
- Persists to `activity.json` per session (220-245)
- Works for all sessions regardless of creation method

### HQ Mode Components

#### Remote Registry (`services/remote-registry.ts`)
- Health checks every 15s (150-187)
- Session ownership tracking (91-148)
- Bearer token authentication
- Automatic unhealthy remote removal

#### HQ Client (`services/hq-client.ts`)
- Registration with HQ (40-90)
- Unique ID generation with UUID v4
- Graceful unregistration on shutdown (92-113)

### Additional Services

#### Push Notifications (`services/push-notification-service.ts`)
- Web Push API integration (64-363)
- Subscription management in `~/.vibetunnel/notifications/`
- Bell event notifications (231-247)
- Automatic expired subscription cleanup

#### Bell Event Handler (`services/bell-event-handler.ts`)
- Processes terminal bell events (59-182)
- Integrates with push notifications
- Includes process context in notifications

#### Authentication Service (`services/auth-service.ts`)
- SSH key authentication (144-159, 201-271)
  - Ed25519 signature verification
  - Challenge-response system
  - Checks `~/.ssh/authorized_keys`
- Password authentication (105-120)
- PAM authentication fallback (184-196)
- JWT token management (176-180)

#### Control Directory Watcher (`services/control-dir-watcher.ts`)
- Monitors external session changes (20-175)
- HQ mode integration (116-163)
- Detects new/removed sessions

### Utilities

#### Logger (`utils/logger.ts`)
- Structured logging with file and console output (1-186)
- Color-coded console with chalk
- Log levels: log, warn, error, debug
- File output to `~/.vibetunnel/log.txt`
- Debug mode via `VIBETUNNEL_DEBUG`

#### VAPID Manager (`utils/vapid-manager.ts`)
- Auto-generates VAPID keys for push notifications (20-331)
- Stores in `~/.vibetunnel/vapid/keys.json`
- Key rotation support

## Client Architecture (`src/client/`)

### Core Components

#### Entry Points
- `app-entry.ts` (1-28): Main entry, initializes Monaco and push notifications
- `test-entry.ts`: Test terminals entry
- `styles.css`: Global Tailwind styles

#### Main Application (`app.ts`)
- Lit-based SPA (15-1200+): `<vibetunnel-app>`
- URL-based routing with `?session=<id>`
- Global keyboard handlers (Cmd+O, Escape)
- View management: auth/list/session
- **Events fired**:
  - `toggle-nav`, `navigate-to-list`, `error`, `success`, `navigate`

### Component Event Architecture

```
vibetunnel-app
├── app-header (navigation, controls)
├── session-list (when view='list')
│   └── session-card (per session)
│       └── vibe-terminal-buffer (terminal preview)
├── session-view (when view='session')
│   ├── session-header
│   ├── vibe-terminal (main terminal)
│   ├── mobile-input-overlay
│   ├── ctrl-alpha-overlay
│   └── terminal-quick-keys
├── session-create-form (modal)
├── file-browser (modal)
├── unified-settings (modal)
└── auth-login (when view='auth')
```

### Terminal Components

#### Terminal (`terminal.ts`)
- Full xterm.js implementation (1-1000+)
- Virtual scrolling (537-555)
- Touch/momentum support
- URL highlighting integration
- **Events**: `terminal-ready`, `terminal-input`, `terminal-resize`, `url-clicked`

#### VibeTunnelBuffer (`vibe-terminal-buffer.ts`)
- Read-only terminal preview (25-268)
- WebSocket buffer subscription
- Auto-resizing
- **Events**: `content-changed`

#### SessionView (`session-view.ts`)
- Full-screen terminal view (29-1331)
- Manager architecture:
  - ConnectionManager: SSE streaming
  - InputManager: Keyboard/mouse
  - MobileInputManager: Mobile input
  - DirectKeyboardManager: Direct keyboard access
  - TerminalLifecycleManager: Terminal state
- **Events**: `navigate-to-list`, `error`, `warning`

### Session Management Components

#### SessionList (`session-list.ts`)
- Grid/list layout (61-700+)
- Hide/show exited sessions
- Search and filtering
- **Events**: `navigate-to-session`, `refresh`, `error`, `success`

#### SessionCard (`session-card.ts`)
- Individual session display (31-420+)
- Live terminal preview
- Activity detection
- **Events**: `session-select`, `session-killed`, `session-kill-error`

#### SessionCreateForm (`session-create-form.ts`)
- Modal dialog (27-381)
- Command input with working directory
- Native terminal spawn option
- **Events**: `session-created`, `cancel`, `error`

### UI Components

#### AppHeader (`app-header.ts`)
- Main navigation (15-280+)
- Session status display
- Theme toggle
- **Events**: `toggle-nav`, `navigate-to-list`, `toggle-create-form`

#### FileBrowser (`file-browser.ts`)
- Filesystem navigation (48-665)
- Git status display
- Monaco editor preview
- **Events**: `insert-path`, `open-in-editor`, `directory-selected`

#### LogViewer (`log-viewer.ts`)
- Real-time log display (1-432)
- SSE-style polling
- Level filtering
- Search functionality

### Services

#### BufferSubscriptionService (`buffer-subscription-service.ts`)
- WebSocket client (30-87)
- Binary protocol decoder (163-208)
- Auto-reconnection with backoff
- Per-session subscriptions

#### PushNotificationService (`push-notification-service.ts`)
- Service worker registration
- Push subscription management
- Notification action handling

#### AuthClient (`auth-client.ts`)
- Token management
- Authentication state
- API header generation

### Utils

#### CastConverter (`cast-converter.ts`)
- Asciinema v2 parser (31-82)
- SSE stream handler (294-427)
- Custom exit event support

#### TerminalRenderer (`terminal-renderer.ts`)
- Binary buffer decoder (279-424)
- HTML generation from buffer
- Style mapping

#### URLHighlighter (`url-highlighter.ts`)
- Multi-line URL detection
- Protocol validation
- Click event handling

## Forward Tool (`src/server/fwd.ts`)

### Purpose
CLI tool for spawning PTY sessions using VibeTunnel infrastructure.

### Usage
```bash
npx tsx src/fwd.ts [--session-id <id>] <command> [args...]

# Examples
npx tsx src/fwd.ts claude --resume
npx tsx src/fwd.ts --session-id abc123 bash -l
```

### Key Features
- Interactive terminal forwarding (43-195)
- Automatic shell alias support via ProcessUtils
- Session ID pre-generation support
- Graceful cleanup on exit
- Colorful output with chalk

### Integration Points
- Uses central PTY Manager (78-82)
- Control pipe handling delegated to PTY Manager
- Terminal resize synchronization (148-163)
- Raw mode for proper input capture (166-172)

## Build System

### Main Build (`scripts/build.js`)
- Asset copying (7-121)
- CSS compilation with Tailwind
- Client bundling with esbuild
- Server TypeScript compilation
- Native executable creation

### Native Binary (`scripts/build-native.js`)
- Node.js SEA integration (1-537)
- node-pty patching for compatibility (82-218)
- Outputs:
  - `native/vibetunnel`: Main executable
  - `native/pty.node`: Terminal emulation
  - `native/spawn-helper`: Process spawning (macOS)
  - `native/authenticate_pam.node`: PAM auth

## Key Files Quick Reference

### Server Core
- `src/cli.ts`: Main entry point
- `src/server/server.ts`: Server implementation
- `src/server/middleware/auth.ts`: Authentication
- `src/server/routes/sessions.ts`: Session API
- `src/server/pty/pty-manager.ts`: PTY management
- `src/server/services/terminal-manager.ts`: Terminal state
- `src/server/services/activity-monitor.ts`: Activity tracking
- `src/server/fwd.ts`: CLI forwarding tool

### Client Core
- `src/client/app-entry.ts`: Entry point
- `src/client/app.ts`: Main SPA
- `src/client/components/terminal.ts`: Terminal renderer
- `src/client/components/session-view.ts`: Session viewer
- `src/client/services/buffer-subscription-service.ts`: WebSocket
- `src/client/utils/cast-converter.ts`: Asciinema parser

### Configuration
- Environment: `PORT`, `VIBETUNNEL_USERNAME`, `VIBETUNNEL_PASSWORD`, `VIBETUNNEL_DEBUG`
- CLI: `--port`, `--username`, `--password`, `--hq`, `--hq-url`, `--name`
- Debug logging: Set `VIBETUNNEL_DEBUG=1` or `true`

### Protocols
- REST API: Session CRUD, terminal I/O
- SSE: Real-time asciinema streaming
- WebSocket: Binary buffer updates
- Control pipes: External session control

### Session Data Storage
Each session has a directory in `~/.vibetunnel/control/[sessionId]/`:
- `session.json`: Session metadata
- `stream-out`: Asciinema cast file
- `stdin`: Input pipe
- `control`: Control pipe
- `activity.json`: Activity status

## Development Notes

### Recent Improvements
- Push notification support for terminal bells
- Multi-method authentication (SSH keys, JWT, PAM)
- Unified logging infrastructure with style guide
- Activity monitoring for all sessions
- Control directory watcher for external sessions
- Improved TypeScript types (no "as any")
- Colorful CLI output with chalk
- Auto-generation of security keys (VAPID)

### Testing
- Unit tests: `pnpm test`
- E2E tests: `pnpm run test:e2e`
- Vitest configuration with coverage

### Key Dependencies
- node-pty: Cross-platform PTY
- @xterm/headless: Terminal emulation
- Lit: Web components
- Express: HTTP server
- web-push: Push notifications
- TailwindCSS: Styling