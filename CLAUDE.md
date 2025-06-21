# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VibeTunnel is a macOS application that allows users to access their terminal sessions through any web browser. It consists of:
- Native macOS app (Swift/SwiftUI) in `mac/`
- iOS companion app in `ios/`  
- Web frontend (TypeScript/LitElement) in `web/`
- Node.js/Bun server for terminal session management

## Critical Development Rules

- **Never commit and/or push before the user has tested your changes!**
- **You do not need to manually build the web project** - the user has `npm run dev` running in a separate terminal
- **Never screenshot via puppeteer** - always query the DOM to see what's what
- **NEVER EVER USE SETTIMEOUT FOR ANYTHING IN THE FRONTEND UNLESS EXPLICITLY PERMITTED**
- **Always run `npm run lint` in web/ before commit and fix ALL issues**
- **Always fix import issues, always fix all lint issues, always typecheck and fix type issues even in unrelated code**

## Web Development Commands

**IMPORTANT**: The user has `npm run dev` running - DO NOT manually build the web project!

In the `web/` directory:

```bash
# Development (user already has this running)
npm run dev

# Code quality (MUST run before commit)
npm run lint          # Check for linting errors
npm run lint:fix      # Auto-fix linting errors
npm run format        # Format with Prettier
npm run typecheck     # Check TypeScript types

# Testing (only when requested)
npm run test
npm run test:coverage
npm run test:e2e
```

## macOS Development Commands

In the `mac/` directory:

```bash
# Build commands
./scripts/build.sh                    # Build release
./scripts/build.sh --configuration Debug  # Build debug
./scripts/build.sh --sign            # Build with code signing

# Other scripts
./scripts/clean.sh                   # Clean build artifacts
./scripts/lint.sh                    # Run linting
./scripts/create-dmg.sh             # Create installer
```

## Architecture Overview

### Terminal Sharing Protocol
1. **Session Creation**: `POST /api/sessions` spawns new terminal
2. **Input**: `POST /api/sessions/:id/input` sends keyboard/mouse input
3. **Output**: 
   - SSE stream at `/api/sessions/:id/stream` (text)
   - WebSocket at `/buffers` (binary, efficient rendering)
4. **Resize**: `POST /api/sessions/:id/resize` (missing in some implementations)

### Key Entry Points
- **Mac App**: `mac/VibeTunnel/VibeTunnelApp.swift`
- **Web Frontend**: `web/src/client/app.ts`
- **Server Management**: `mac/VibeTunnel/Core/Services/ServerManager.swift`
- **Terminal Protocol**: `web/src/client/services/buffer-subscription-service.ts`

### Core Services
- `ServerManager`: Orchestrates server lifecycle
- `SessionMonitor`: Tracks active terminal sessions
- `TTYForwardManager`: Manages terminal forwarding
- `BufferSubscriptionService`: WebSocket client for terminal updates

## Development Workflow

1. **Before starting**: Check `web/spec.md` for detailed implementation guide
2. **Making changes**: Edit source files directly - auto-rebuild handles compilation
3. **Before committing**:
   - Run `npm run lint` and fix ALL issues
   - Run `npm run typecheck` and fix ALL type errors
   - Ensure the user has tested your changes

## Important Notes

- **Server Implementation**: Node.js/Bun server handles all terminal sessions
- **Binary Terminal Protocol**: Custom format for efficient terminal state sync
- **Session Recording**: All sessions saved in asciinema format
- **Security**: Local-only by default, optional password protection

## Testing

- **Never run tests unless explicitly asked**
- Mac tests: Swift Testing framework in `VibeTunnelTests/`
- Web tests: Vitest in `web/src/test/`

## Key Files Quick Reference

- API Documentation: `docs/API.md`
- Architecture Details: `docs/ARCHITECTURE.md`
- Web Implementation Guide: `web/spec.md`
- Build Configuration: `web/package.json`, `mac/Package.swift`