# Bun Prebuilt Binaries

This directory contains pre-built Bun executables and native modules for both architectures.

## Directory Structure

```
BunPrebuilts/
├── arm64/
│   ├── vibetunnel      # Bun executable for Apple Silicon
│   ├── pty.node        # Native module for Apple Silicon
│   └── spawn-helper    # Helper binary for Apple Silicon
└── x86_64/
    ├── vibetunnel      # Bun executable for Intel
    ├── pty.node        # Native module for Intel
    └── spawn-helper    # Helper binary for Intel
```

## Building for Each Architecture

### On Apple Silicon Mac:
```bash
cd web
bun build-native.js
cp native/vibetunnel ../mac/Resources/BunPrebuilts/arm64/
cp native/pty.node ../mac/Resources/BunPrebuilts/arm64/
cp native/spawn-helper ../mac/Resources/BunPrebuilts/arm64/
```

### On Intel Mac:
```bash
cd web
bun build-native.js
cp native/vibetunnel ../mac/Resources/BunPrebuilts/x86_64/
cp native/pty.node ../mac/Resources/BunPrebuilts/x86_64/
cp native/spawn-helper ../mac/Resources/BunPrebuilts/x86_64/
```

## Notes

- These binaries are architecture-specific and cannot be made universal
- The build script will use these pre-built binaries if available
- If binaries are missing for an architecture, that architecture won't have Bun support