# VibeTunnel CLI

Full-featured terminal sharing server with web interface for macOS and Linux. Windows not yet supported.

## Installation

### From npm (Recommended)
```bash
npm install -g vibetunnel
```

### From Source
```bash
git clone https://github.com/amantus-ai/vibetunnel.git
cd vibetunnel/web
pnpm install
pnpm run build
```

## Installation Differences

**npm package**:
- Pre-built binaries for common platforms (macOS x64/arm64, Linux x64/arm64)
- Automatic fallback to source compilation if pre-built binaries unavailable
- Global installation makes `vibetunnel` and `vt` commands available system-wide
- Includes production dependencies only

**Source installation**:
- Full development environment with hot reload (`pnpm run dev`)
- Access to all development scripts and tools
- Ability to modify and rebuild the application
- Includes test suites and development dependencies

## Requirements

- Node.js >= 20.0.0
- macOS or Linux (Windows not yet supported)
- Build tools for native modules (Xcode on macOS, build-essential on Linux)

## Usage

### Start the server

```bash
# Start with default settings (port 4020)
vibetunnel

# Start with custom port
vibetunnel --port 8080

# Start without authentication
vibetunnel --no-auth
```

Then open http://localhost:4020 in your browser to access the web interface.

### Use the vt command wrapper

The `vt` command allows you to run commands with TTY forwarding:

```bash
# Monitor AI agents with automatic activity tracking
vt claude
vt claude --dangerously-skip-permissions

# Run commands with output visible in VibeTunnel
vt npm test
vt python script.py
vt top

# Launch interactive shell
vt --shell
vt -i

# Update session title (inside a session)
vt title "My Project"
```

### Forward commands to a session

```bash
# Basic usage
vibetunnel fwd <session-id> <command> [args...]

# Examples
vibetunnel fwd --session-id abc123 ls -la
vibetunnel fwd --session-id abc123 npm test
vibetunnel fwd --session-id abc123 python script.py
```

## Features

- **Web-based terminal interface** - Access terminals from any browser
- **Multiple concurrent sessions** - Run multiple terminals simultaneously
- **Real-time synchronization** - See output in real-time
- **TTY forwarding** - Full terminal emulation support
- **Session management** - Create, list, and manage sessions
- **Cross-platform** - Works on macOS and Linux
- **No dependencies** - Just Node.js required

## Package Contents

This npm package includes:
- Full VibeTunnel server with web UI
- Command-line tools (vibetunnel, vt)
- Native PTY support for terminal emulation
- Web interface with xterm.js
- Session management and forwarding

## Platform Support

- macOS (Intel and Apple Silicon)
- Linux (x64 and ARM64)
- Windows: Not yet supported ([#252](https://github.com/amantus-ai/vibetunnel/issues/252))

## Troubleshooting

### Installation Issues

If you encounter issues during installation:

1. **Missing Build Tools**: Install build essentials
   ```bash
   # Ubuntu/Debian
   sudo apt-get install build-essential python3-dev
   
   # macOS
   xcode-select --install
   ```

2. **Permission Issues**: Use sudo for global installation
   ```bash
   sudo npm install -g vibetunnel
   ```

3. **Node Version**: Ensure Node.js 20+ is installed
   ```bash
   node --version
   ```

### Runtime Issues

- **Server Won't Start**: Check if port is already in use
- **Authentication Failed**: Verify system authentication setup
- **Terminal Not Responsive**: Check browser console for WebSocket errors

### Development Setup

For source installations:
```bash
# Install dependencies
pnpm install

# Run development server with hot reload
pnpm run dev

# Run code quality checks
pnpm run check

# Build for production
pnpm run build
```

## Documentation

See the main repository for complete documentation: https://github.com/amantus-ai/vibetunnel

## License

MIT
