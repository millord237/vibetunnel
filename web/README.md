# VibeTunnel

Web-based terminal multiplexer with distributed architecture support.

## Quick Start

```bash
npm install
npm run dev   # Starts server + auto-rebuilds
```

Open http://localhost:3000

## Server Modes

```bash
# Standalone server
npm run dev

# HQ server (manages remote servers)
npm run dev -- --hq

# Remote server (connects to HQ)
npm run dev -- --hq-url http://hq-server:3000 --name remote1
```

## Build & Test

```bash
npm run build      # Production build
npm run lint       # Check code style
npm run typecheck  # Type checking
npm test           # Run tests
```

## fwd Tool

CLI that spawns PTY sessions integrated with VibeTunnel:

```bash
# Forward a command to VibeTunnel
npx tsx src/fwd.ts <command> [args...]

# Monitor-only mode (no input)
npx tsx src/fwd.ts --monitor-only <command>
```

Creates persistent sessions accessible via the web UI.

## Architecture

- **Server**: Express + node-pty for terminal sessions
- **Client**: Lit web components + xterm.js 
- **Streaming**: SSE for output, WebSocket for binary buffers
- **Protocol**: Binary-optimized terminal state synchronization