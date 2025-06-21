# Bun Server Support

VibeTunnel now includes support for running with Bun, a high-performance JavaScript runtime with built-in native module support.

## Architecture Considerations

**Important**: Bun does not support universal binaries. The Bun executable is architecture-specific and will be built for the native architecture during compilation. Despite this limitation, VibeTunnel still creates a universal binary for the main application, with the Bun executable being selected at runtime based on the current architecture.

## Features

- High-performance JavaScript/TypeScript execution
- Built-in native module support (pty.node, spawn-helper)
- Integrated `fwd` command for terminal forwarding
- Smaller binary size compared to Node.js

## Building with Bun Support

### Automatic Build (Recommended)

The Bun executable is automatically built during the main build process. The build script:
1. Detects the native architecture
2. Builds the Bun executable for that architecture
3. Embeds it into the universal app bundle

**Note**: Each build contains only the Bun executable for the build machine's architecture. For a true universal distribution, separate builds on Intel and Apple Silicon machines would need to be combined.

### Manual Build

If you need to build the Bun executable manually:

```bash
cd web
node build-native.js
```

This creates:
- `native/vibetunnel` - The Bun executable
- `native/pty.node` - Native PTY module
- `native/spawn-helper` - Helper binary for spawning processes

### Verification

To verify Bun support is properly built:

```bash
# Check if files exist
ls -la web/native/

# Test the executable
web/native/vibetunnel --version
```

## CLI Usage

When using the Bun server, the `vt` command automatically prepends `fwd`:

```bash
# With Go server:
vt mycommand  # → vibetunnel mycommand

# With Bun server:
vt mycommand  # → vibetunnel fwd mycommand
```

## Switching Between Servers

You can switch between Go and Bun servers in Settings → Debug → Server Type.

When switching, you may need to reinstall the CLI tools to update the `vt` wrapper script.

## Troubleshooting

### "Bun server is not available"

This error means the Bun executable or native modules are missing. Solutions:

1. Ensure the build script runs: Check Xcode build logs for "Build Bun Executable"
2. Build manually: `cd web && node build-native.js`
3. Verify files: Check `VibeTunnel.app/Contents/Resources/` for:
   - vibetunnel (60MB executable)
   - pty.node
   - spawn-helper

### CLI not working after switching

After switching server types, reinstall the CLI tools:
1. Settings → Advanced → Reinstall CLI Tools
2. Enter admin password when prompted
3. The installer will create the appropriate `vt` script/symlink

## Development

The Bun server code is in:
- `mac/VibeTunnel/Core/Services/BunServer.swift` - Swift integration
- `web/src/server/` - JavaScript server implementation
- `web/build-native.js` - Build script for creating the Bun executable