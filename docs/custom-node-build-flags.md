# Custom Node.js Build Flags

## Executive Summary: Size Optimization Results

### Final Size Report
- **Standard Node.js**: 110MB → **Custom Node.js**: 59.08MB (**46.5% reduction**)
- **Standard vibetunnel**: 107MB → **Optimized vibetunnel**: 61.05MB (**42.9% reduction**)

### Optimization Breakdown
| Configuration | Node.js Size | vibetunnel Size | Reduction | Status |
|--------------|--------------|-----------------|-----------|---------|
| Standard Node.js | 110MB | 107MB | Baseline | ✅ Works |
| Feature removals only | 64.30MB | 66.30MB | 38.0% | ✅ Works |
| + `-Os` optimization | 59.08MB | 61.05MB | 42.9% | ✅ **Recommended** |
| + `-Wl,-dead_strip` | 56.18MB | N/A | 48.9% | ❌ Segfault |
| + `-flto` | 49.65MB | 51.87MB | 51.5% | ❌ Segfault |
| + `-ffunction-sections` | 59.08MB | 61.05MB | 42.9% | ✅ No benefit |
| UPX compression | 36MB | N/A | 67.3% | ❌ Hangs |

### Key Findings
1. **Safe optimizations achieve 46.5% reduction** without compromising functionality
2. **More aggressive optimizations break native module compatibility** despite better compression
3. **Node.js 24.2.0 performs identically to 24.1.0** in terms of size and compatibility

## Recommended Production Configuration

```bash
./configure \
  --without-intl \
  --without-npm \
  --without-corepack \
  --without-inspector \
  --without-node-code-cache \
  --without-node-snapshot \
  --ninja

export CFLAGS='-Os'
export CXXFLAGS='-Os'
```

This configuration:
- Removes unnecessary features (internationalization, npm, debugging tools)
- Applies safe size optimization (`-Os`)
- Maintains full compatibility with native modules
- Achieves 46.5% size reduction

## Detailed Test Results

### Working Configurations

#### Configuration 1: Feature Removals + `-Os` (Node.js 24.2.0) ✅
```bash
--without-intl --without-npm --without-corepack --without-inspector
--without-node-code-cache --without-node-snapshot --ninja
CFLAGS='-Os' CXXFLAGS='-Os'
```
- **Result**: SUCCESS - vibetunnel works perfectly
- **Size**: 59.08MB Node.js, 61.05MB vibetunnel
- **Notes**: Optimal balance of size reduction and compatibility

#### Configuration 2: Feature Removals + `-Os` + Function Sections (Node.js 24.2.0) ✅
```bash
--without-intl --without-npm --without-corepack --without-inspector
--without-node-code-cache --without-node-snapshot --ninja
CFLAGS='-Os -ffunction-sections -fdata-sections' 
CXXFLAGS='-Os -ffunction-sections -fdata-sections'
```
- **Result**: SUCCESS - vibetunnel works perfectly
- **Size**: 59.08MB Node.js, 61.05MB vibetunnel
- **Notes**: Function/data sections provide no additional benefit on macOS

### Failed Configurations

#### Configuration 3: Feature Removals + `-Wl,-dead_strip` ❌
```bash
--without-intl --without-npm --without-corepack --without-inspector
--without-node-code-cache --without-node-snapshot --ninja
LDFLAGS='-Wl,-dead_strip'
```
- **Result**: FAILED - Segmentation fault (exit code 139)
- **Size**: 56.18MB Node.js (would save 3MB)
- **Notes**: Dead code stripping breaks native module loading

#### Configuration 4: Feature Removals + `-flto` ❌
```bash
--without-intl --without-npm --without-corepack --without-inspector
--without-node-code-cache --without-node-snapshot --ninja
CFLAGS='-flto' CXXFLAGS='-flto' LDFLAGS='-flto'
```
- **Result**: FAILED - Segmentation fault (exit code 139)
- **Size**: 49.65MB Node.js (would save 9MB)
- **Notes**: Link-time optimization breaks native module compatibility

#### Configuration 5: UPX Compression ❌
```bash
upx -1 --force-macos vibetunnel
```
- **Result**: FAILED - Binary hangs on execution
- **Size**: 36MB vibetunnel (would save 25MB)
- **Notes**: UPX compression breaks macOS executables

## Technical Analysis

### Why Some Optimizations Fail

1. **`-Wl,-dead_strip` and `-flto`**: These aggressive optimizations remove or modify symbols that native modules depend on during dynamic loading via `process.dlopen()`

2. **UPX Compression**: macOS security features and code signing requirements conflict with runtime decompression

3. **Function/Data Sections**: Without corresponding linker support (`--gc-sections` not available on macOS), these flags provide no benefit

### Feature Removal Impact

Each `--without-*` flag contributes to size reduction:
- `--without-intl`: Removes ICU (International Components for Unicode) - largest savings
- `--without-npm`: Removes npm package manager
- `--without-inspector`: Removes debugging/profiling tools
- `--without-corepack`: Removes yarn/pnpm management
- `--without-node-code-cache`: Disables V8 code caching
- `--without-node-snapshot`: Prevents startup snapshot creation

## Usage Instructions

### Building Custom Node.js

```bash
node build-custom-node.js               # Builds Node.js 24.2.0 (default)
node build-custom-node.js --version=24.2.0  # Specific version
node build-custom-node.js --latest      # Latest version
```

### Using Custom Node.js

#### Option 1: Command Line
```bash
node build-native.js --custom-node      # Auto-detect from .node-builds/
node build-native.js --custom-node="/path/to/custom/node"  # Specific path
```

#### Option 2: Environment Variable (Recommended for Xcode)
```bash
export VIBETUNNEL_USE_CUSTOM_NODE=YES   # Use custom Node.js
export VIBETUNNEL_USE_CUSTOM_NODE=NO    # Use system Node.js
node build-native.js                    # Respects environment variable
```

### Xcode Integration

For macOS development, set `VIBETUNNEL_USE_CUSTOM_NODE` in Build Settings:
- **YES**: Always use custom Node.js (61MB executable)
- **NO**: Always use system Node.js (107MB executable)
- **(not set)**: Auto-detect based on build configuration

See [Xcode Custom Node Setup](xcode-custom-node-setup.md) for detailed instructions.

## Future Optimization Opportunities

While not tested due to potential compatibility issues:
- `--without-ssl`: Could save significant space but removes HTTPS support
- `--without-v8-platform`: Might reduce size but could break core functionality
- Custom V8 builds: Theoretical possibility but extremely complex

## Conclusion

The current configuration achieves an optimal 46.5% size reduction while maintaining full functionality and native module compatibility. Further size reductions are possible but come at the cost of breaking critical features or compatibility.