# PTY Module

A Node.js/TypeScript implementation for managing PTY (pseudo-terminal) sessions using node-pty.

## Features

- **Native Node.js Implementation**: Uses `node-pty` for high-performance terminal management
- **Asciinema Recording**: Records terminal sessions in standard asciinema format
- **Session Persistence**: Sessions persist across restarts with metadata
- **TypeScript Support**: Fully typed interfaces and error handling

## Quick Start

```typescript
import { PtyManager } from './pty/index.js';

// Create PTY manager
const ptyManager = new PtyManager('/path/to/control');

// Create a session
const result = await ptyManager.createSession(['bash'], {
  sessionName: 'my-session',
  workingDir: '/home/user',
  cols: 80,
  rows: 24,
});

console.log(`Created session: ${result.sessionId}`);

// Send input to session
ptyManager.sendInput(result.sessionId, { text: 'echo hello\n' });

// List all sessions
const sessions = ptyManager.listSessions();

// Cleanup session
ptyManager.cleanupSession(result.sessionId);
```

## API Reference

### PtyManager

Main class for managing PTY sessions.

#### Constructor

```typescript
new PtyManager(controlPath: string)
```

- `controlPath`: Directory path for session storage

#### Methods

##### `createSession(command: string[], options?: SessionOptions): Promise<SessionCreationResult>`

Creates a new PTY session.

**Parameters:**

- `command`: Array of command and arguments to execute
- `options`: Optional session configuration

**Returns:** Promise resolving to session ID and info

**Example:**

```typescript
const result = await ptyManager.createSession(['vim', 'file.txt'], {
  sessionName: 'vim-session',
  workingDir: '/home/user/projects',
  term: 'xterm-256color',
  cols: 120,
  rows: 30,
});
```

##### `sendInput(sessionId: string, input: SessionInput): void`

Sends input to a session.

**Parameters:**

- `sessionId`: Target session ID
- `input`: Text or special key input

**Example:**

```typescript
// Send text
ptyManager.sendInput(sessionId, { text: 'hello world\n' });

// Send special key
ptyManager.sendInput(sessionId, { key: 'arrow_up' });
```

**Supported special keys:**

- `arrow_up`, `arrow_down`, `arrow_left`, `arrow_right`
- `escape`, `enter`, `ctrl_enter`, `shift_enter`

##### `listSessions(): SessionEntryWithId[]`

Lists all sessions with metadata.

##### `getSession(sessionId: string): SessionEntryWithId | null`

Gets specific session by ID.

##### `killSession(sessionId: string, signal?: string | number): Promise<void>`

Terminates a session and waits for the process to actually be killed.

**Parameters:**

- `sessionId`: Session to terminate
- `signal`: Signal to send (default: 'SIGTERM')

**Returns:** Promise that resolves when the process is actually terminated

**Process:**

1. Sends SIGTERM initially
2. Waits up to 3 seconds (checking every 500ms)
3. Sends SIGKILL if process doesn't terminate gracefully
4. Resolves when process is confirmed dead

##### `cleanupSession(sessionId: string): void`

Removes session and cleans up files.

##### `cleanupExitedSessions(): string[]`

Removes all exited sessions and returns cleaned session IDs.

##### `resizeSession(sessionId: string, cols: number, rows: number): void`

Resizes session terminal.

##### `getActiveSessionCount(): number`

Returns number of active sessions.

## Session File Structure

Sessions are stored in a directory structure:

```
~/.vibetunnel/control/
├── session-uuid-1/
│   ├── session.json          # Session metadata
│   ├── stream-out           # Asciinema recording
│   ├── stdin                # Input pipe/file
│   └── notification-stream  # Event notifications
└── session-uuid-2/
    └── ...
```

### session.json Format

```json
{
  "cmdline": ["bash", "-l"],
  "name": "my-session",
  "cwd": "/home/user",
  "pid": 1234,
  "status": "running",
  "exit_code": null,
  "started_at": "2023-12-01T10:00:00.000Z",
  "term": "xterm-256color",
  "spawn_type": "pty"
}
```

### Asciinema Format

The `stream-out` file follows the [asciinema file format](https://github.com/asciinema/asciinema/blob/develop/doc/asciicast-v2.md):

```
{"version": 2, "width": 80, "height": 24, "timestamp": 1609459200, "env": {"SHELL": "/bin/bash", "TERM": "xterm-256color"}}
[0.248848, "o", "\u001b]0;user@host: ~\u0007\u001b[01;32muser@host\u001b[00m:\u001b[01;34m~\u001b[00m$ "]
[1.001376, "o", "h"]
[1.064593, "o", "e"]
```

## Error Handling

All methods throw `PtyError` instances with structured error information:

```typescript
try {
  await ptyManager.createSession(['invalid-command']);
} catch (error) {
  if (error instanceof PtyError) {
    console.error(`PTY Error [${error.code}]: ${error.message}`);
    if (error.sessionId) {
      console.error(`Session ID: ${error.sessionId}`);
    }
  }
}
```

## Performance Considerations

- **Memory Usage**: ~10-20MB per active session
- **CPU Overhead**: Minimal, event-driven
- **Latency**: < 5ms for input/output operations
- **Concurrency**: Supports 50+ concurrent sessions

## License

Licensed under the same license as the parent project.
