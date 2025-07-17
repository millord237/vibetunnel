## [1.0.0-beta.11] - 2025-01-16

#### **Better Settings Organization**
- Reorganized settings into logical tabs for easier navigation (#359)
- Repository base path now syncs automatically between Mac app and web UI (#358)
- Simplified welcome screen repository display (#372)

#### **Improved WebRTC Support**
- Fixed threading issues in WebRTC screen capture (#375, #378)
- Resolved screen capture authentication problems (#264, #374)
- More stable screen sharing with proper main thread dispatch

#### **UI Context Awareness**
- Screen sharing button only appears when Mac app is connected (#367)
- Spawn window toggle shows only when relevant (#357)

#### **NPM Package Now Available**
- vibetunnel (server) is now available as an npm package for easy installation on macOS and Linux (#360, #377)
- Install with `npm install -g vibetunnel` - no build tools required\!
- Includes prebuilt binaries for Node.js 20, 22, 23, and 24
- Supports macOS (Intel and Apple Silicon) and Linux (x64 and arm64) (#344)

#### **Enhanced Git Diff Tool Support**
- Added JuxtaCode to the list of supported Git diff tools with automatic detection

#### **Improved `vt` Command**
- Added verbosity control with `-q` (quiet), `-v` (verbose), `-vv` (extra verbose) flags (#356)
- New `vt title` command to update session names from within a VibeTunnel session

### 🐛 Bug Fixes

- Fixed npm package installation issues (#360, #377)
- Fixed control message processing loop (#372)
- Fixed file browser constant refresh issue (#354)
- Replaced bell icon with settings icon for better clarity (#366)
- Resolved Tailwind CSS performance warning
- Fixed repeated screen recording permission dialogs
EOF < /dev/null