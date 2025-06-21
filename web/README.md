# VibeTunnel Web

Web terminal interface and server for VibeTunnel.

## Quick Start

Production users: Use the pre-built VibeTunnel executable from the main app.

## Development

```bash
npm install
npm run dev        # Watch mode: server + client
npm run dev:client # Watch mode: client only (for debugging server)
```

Open http://localhost:3000

### Build Commands

```bash
npm run clean      # Remove build artifacts
npm run build      # Build everything (including native executable)
npm run lint       # Check code style
npm run lint:fix   # Fix code style
npm run typecheck  # Type checking
npm run test       # Run all tests (unit + e2e)
npm run format     # Format code
```

## Production Build

```bash
npm run build          # Creates Node.js SEA executable
./native/vibetunnel    # Run standalone executable (no Node.js required)
```

## Architecture

See [spec.md](./spec.md) for detailed architecture documentation.

## Key Features

- Terminal sessions via node-pty
- Real-time streaming (SSE + WebSocket)
- Binary-optimized buffer updates
- Multi-session support
- File browser integration