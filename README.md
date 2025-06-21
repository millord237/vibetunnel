<!-- Generated: 2025-06-21 18:45:00 UTC -->
![VibeTunnel Banner](assets/banner.png)

# VibeTunnel

**Turn any browser into your Mac terminal.** VibeTunnel proxies your terminals right into the browser, so you can vibe-code anywhere.

[![Download](https://img.shields.io/badge/Download-macOS-blue)](https://github.com/amantus-ai/vibetunnel/releases/latest)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)
[![macOS 14.0+](https://img.shields.io/badge/macOS-14.0+-red)](https://www.apple.com/macos/)
[![Apple Silicon](https://img.shields.io/badge/Apple%20Silicon-Required-orange)](https://support.apple.com/en-us/HT211814)

## Why VibeTunnel?

Ever wanted to check on your AI agents while you're away? Need to monitor that long-running build from your phone? Want to share a terminal session with a colleague without complex SSH setups? VibeTunnel makes it happen with zero friction.

## Quick Start

### Requirements

**VibeTunnel requires an Apple Silicon Mac (M1+).** Intel Macs are not supported.

### 1. Download & Install

[Download VibeTunnel](https://github.com/amantus-ai/vibetunnel/releases/latest) and drag it to your Applications folder.

### 2. Launch VibeTunnel

VibeTunnel lives in your menu bar. Click the icon to start the server.

### 3. Use the `vt` Command

```bash
# Run any command in the browser
vt npm run dev

# Monitor AI agents
vt claude --dangerously-skip-permissions

# Open an interactive shell
vt --shell
```

### 4. Open Your Dashboard

Visit [http://localhost:4020](http://localhost:4020) to see all your terminal sessions.

## Features

- **🌐 Browser-Based Access** - Control your Mac terminal from any device with a web browser
- **🚀 Zero Configuration** - No SSH keys, no port forwarding, no complexity
- **🤖 AI Agent Friendly** - Perfect for monitoring Claude Code, ChatGPT, or any terminal-based AI tools
- **🔒 Secure by Design** - Password protection, localhost-only mode, or secure tunneling via Tailscale/ngrok
- **📱 Mobile Ready** - Native iOS app and responsive web interface for phones and tablets
- **🎬 Session Recording** - All sessions recorded in asciinema format for later playback
- **⚡ High Performance** - Powered by Bun runtime for blazing-fast JavaScript execution
- **🍎 Apple Silicon Native** - Optimized for M1/M2/M3 Macs with ARM64-only binaries

## Architecture

VibeTunnel consists of three main components:

1. **macOS Menu Bar App** - Native Swift application that manages the server lifecycle
2. **Node.js/Bun Server** - High-performance TypeScript server handling terminal sessions
3. **Web Frontend** - Modern web interface using Lit components and xterm.js

The server runs as a standalone Bun executable with embedded Node.js modules, providing excellent performance and minimal resource usage.

## Remote Access Options

### Option 1: Tailscale (Recommended)
1. Install [Tailscale](https://tailscale.com) on your Mac and remote device
2. Access VibeTunnel at `http://[your-mac-name]:4020`

### Option 2: ngrok
1. Add your ngrok auth token in VibeTunnel settings
2. Enable ngrok tunneling
3. Share the generated URL

### Option 3: Local Network
1. Set a dashboard password in settings
2. Switch to "Network" mode
3. Access via `http://[your-mac-ip]:4020`

## Building from Source

### Prerequisites
- macOS 14.0+ (Sonoma) on Apple Silicon (M1/M2/M3)
- Xcode 16.0+
- Node.js 20+
- Bun runtime

### Build Steps

```bash
# Clone the repository
git clone https://github.com/amantus-ai/vibetunnel.git
cd vibetunnel

# Build the web server
cd web
npm install
npm run build
node build-native.js  # Creates Bun executable

# Build the macOS app
cd ../mac
./scripts/build.sh --configuration Release
```

## Development

For development setup and contribution guidelines, see [CONTRIBUTING.md](docs/CONTRIBUTING.md).

### Key Files
- **macOS App**: `mac/VibeTunnel/VibeTunnelApp.swift`
- **Server**: `web/src/server/` (TypeScript/Node.js)
- **Web UI**: `web/src/client/` (Lit/TypeScript)
- **iOS App**: `ios/VibeTunnel/`

## Documentation

- [Technical Specification](docs/spec.md) - Detailed architecture and implementation
- [Contributing Guide](docs/CONTRIBUTING.md) - Development setup and guidelines
- [Architecture](docs/architecture.md) - System design overview
- [Build System](docs/build-system.md) - Build process details

## Credits

Created with ❤️ by:
- [@badlogic](https://mariozechner.at/) - Mario Zechner
- [@mitsuhiko](https://lucumr.pocoo.org/) - Armin Ronacher  
- [@steipete](https://steipete.com/) - Peter Steinberger

## License

VibeTunnel is open source software licensed under the MIT License. See [LICENSE](LICENSE) for details.

---

**Ready to vibe?** [Download VibeTunnel](https://github.com/amantus-ai/vibetunnel/releases/latest) and start tunneling!