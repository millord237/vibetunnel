# VibeTunnel OpenCode Configuration

This file contains frequently used commands and project-specific information for VibeTunnel development.

## Project Overview

VibeTunnel is a macOS application that allows users to access their terminal sessions through any web browser. It consists of:
- Native macOS app (Swift/SwiftUI) in `mac/`
- iOS companion app in `ios/`
- Web frontend (TypeScript/LitElement) and Node.js/Bun server in `web/`

## Essential Commands

### Web Development (in `web/` directory)

```bash
# Development
pnpm run dev                   # Standalone development server (port 4020)
pnpm run dev --port 4021       # Alternative port for external device testing

# Code quality (MUST run before commit)
pnpm run lint                  # Check for linting errors
pnpm run lint:fix              # Auto-fix linting errors
pnpm run format                # Format with Prettier
pnpm run typecheck             # Check TypeScript types

# Testing (only when requested)
pnpm run test
pnpm run test:coverage
pnpm run test:e2e
```

### macOS Development (in `mac/` directory)

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

### iOS Development (in `ios/` directory)

```bash
# Testing
./scripts/test-with-coverage.sh     # Run tests with coverage
./run-tests.sh                      # Quick test run
```

### Project-wide Commands

```bash
# Run all tests with coverage
./scripts/test-all-coverage.sh

# Validate documentation
./scripts/validate-docs.sh
```

## Development Workflow

### Web Development Modes

1. **Production Mode**: Mac app embeds pre-built web server
   - Every web change requires: clean → build → run
   - Simply restarting serves STALE, CACHED version

2. **Development Mode** (recommended for web development):
   - Enable "Use Development Server" in VibeTunnel Settings → Debug
   - Mac app runs `pnpm run dev` instead of embedded server
   - Provides hot reload - web changes automatically rebuild

### Testing on External Devices

```bash
# Run dev server accessible from external devices
cd web
pnpm run dev --port 4021 --bind 0.0.0.0
```

Then access from external device using `http://[mac-ip]:4021`

## Code Style Preferences

- Use TypeScript for all new web code
- Follow existing Swift conventions for macOS/iOS
- Run linting and formatting before commits
- Maintain test coverage (75% for macOS/iOS, 80% for web)

## Architecture Notes

### Key Entry Points
- **Mac App**: `mac/VibeTunnel/VibeTunnelApp.swift`
- **Web Frontend**: `web/src/client/app.ts`
- **Server**: `web/src/server/server.ts`
- **Server Management**: `mac/VibeTunnel/Core/Services/ServerManager.swift`

### Terminal Sharing Protocol
1. **Session Creation**: `POST /api/sessions` spawns new terminal
2. **Input**: `POST /api/sessions/:id/input` sends keyboard/mouse input
3. **Output**: SSE stream at `/api/sessions/:id/stream` (text) + WebSocket at `/buffers` (binary)
4. **Resize**: `POST /api/sessions/:id/resize`

## Important Rules

1. **NEVER create new branches without explicit user permission**
2. **NEVER commit/push before user has tested changes**
3. **NEVER use `git rebase --skip`**
4. **NEVER create duplicate files with version numbers**
5. **NEVER kill all sessions** (you're running inside one)
6. **NEVER rename docs.json to mint.json**

## Useful File Locations

- Project documentation: `docs/`
- Build configurations: `web/package.json`, `mac/Package.swift`
- CI configuration: `.github/workflows/`
- Release process: `docs/RELEASE.md`