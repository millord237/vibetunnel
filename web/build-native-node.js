#!/usr/bin/env node

/**
 * Minimal Node.js SEA build script - NO BUN!
 * Bundles src/cli.ts and all imports into a single executable
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Building standalone vibetunnel executable using Node.js SEA...');
console.log(`Node.js version: ${process.version}`);

// Check Node.js version
const nodeVersion = parseInt(process.version.split('.')[0].substring(1));
if (nodeVersion < 20) {
  console.error('Error: Node.js 20 or higher is required for SEA feature');
  process.exit(1);
}

function patchNodePty() {
  console.log('Patching node-pty for SEA build...');

  // Patch prebuild-loader.js to use process.dlopen instead of require
  const prebuildLoaderFile = path.join(__dirname, 'node_modules/@homebridge/node-pty-prebuilt-multiarch/lib/prebuild-loader.js');
  const prebuildLoaderContent = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var path = require("path");
var fs = require("fs");

// Custom loader for SEA that uses process.dlopen
var pty;

// Helper function to load native module using dlopen
function loadNativeModule(modulePath) {
  const module = { exports: {} };
  process.dlopen(module, modulePath);
  return module.exports;
}

// Determine the path to pty.node
function getPtyPath() {
  const execDir = path.dirname(process.execPath);
  // Look for pty.node next to the executable first
  const ptyPath = path.join(execDir, 'pty.node');
  
  if (fs.existsSync(ptyPath)) {
    return ptyPath;
  }
  
  // If not found, throw error with helpful message
  throw new Error('Could not find pty.node next to executable at: ' + ptyPath);
}

try {
  const ptyPath = getPtyPath();
  console.log('Loading pty.node from:', ptyPath);
  
  // Set spawn-helper path for Unix systems
  if (process.platform !== 'win32') {
    const execDir = path.dirname(process.execPath);
    const spawnHelperPath = path.join(execDir, 'spawn-helper');
    if (fs.existsSync(spawnHelperPath)) {
      process.env.NODE_PTY_SPAWN_HELPER_PATH = spawnHelperPath;
      console.log('Set spawn-helper path:', spawnHelperPath);
    } else {
      console.error('Warning: spawn-helper not found at:', spawnHelperPath);
    }
  }
  
  pty = loadNativeModule(ptyPath);
} catch (error) {
  console.error('Failed to load pty.node:', error);
  throw error;
}

exports.default = pty;
//# sourceMappingURL=prebuild-loader.js.map`;

  fs.writeFileSync(prebuildLoaderFile, prebuildLoaderContent);
  
  // Also patch windowsPtyAgent.js if it exists
  const windowsPtyAgentFile = path.join(__dirname, 'node_modules/@homebridge/node-pty-prebuilt-multiarch/lib/windowsPtyAgent.js');
  if (fs.existsSync(windowsPtyAgentFile)) {
    let content = fs.readFileSync(windowsPtyAgentFile, 'utf8');
    // Replace direct require of .node files with our loader
    content = content.replace(
      /require\(['"]\.\.\/build\/Release\/pty\.node['"]\)/g,
      "require('./prebuild-loader').default"
    );
    fs.writeFileSync(windowsPtyAgentFile, content);
  }
  
  // Patch index.js exports.native line
  const indexFile = path.join(__dirname, 'node_modules/@homebridge/node-pty-prebuilt-multiarch/lib/index.js');
  if (fs.existsSync(indexFile)) {
    let content = fs.readFileSync(indexFile, 'utf8');
    // Replace the exports.native line that directly requires .node
    content = content.replace(
      /exports\.native = \(process\.platform !== 'win32' \? require\(prebuild_file_path_1\.ptyPath \|\| '\.\.\/build\/Release\/pty\.node'\) : null\);/,
      "exports.native = (process.platform !== 'win32' ? require('./prebuild-loader').default : null);"
    );
    fs.writeFileSync(indexFile, content);
  }
  
  // Patch unixTerminal.js to fix spawn-helper path resolution
  const unixTerminalFile = path.join(__dirname, 'node_modules/@homebridge/node-pty-prebuilt-multiarch/lib/unixTerminal.js');
  if (fs.existsSync(unixTerminalFile)) {
    let content = fs.readFileSync(unixTerminalFile, 'utf8');
    
    // Replace the helperPath resolution logic
    const helperPathPatch = `var helperPath;
// For SEA, use spawn-helper from environment or next to executable
if (process.env.NODE_PTY_SPAWN_HELPER_PATH) {
  helperPath = process.env.NODE_PTY_SPAWN_HELPER_PATH;
  console.log('[node-pty] Using spawn-helper from env:', helperPath);
} else {
  // In SEA context, look next to the executable
  const execDir = path.dirname(process.execPath);
  const spawnHelperPath = path.join(execDir, 'spawn-helper');
  if (require('fs').existsSync(spawnHelperPath)) {
    helperPath = spawnHelperPath;
    console.log('[node-pty] Using spawn-helper next to executable:', helperPath);
  } else {
    // Fallback to original logic
    helperPath = '../build/Release/spawn-helper';
    helperPath = path.resolve(__dirname, helperPath);
    helperPath = helperPath.replace('app.asar', 'app.asar.unpacked');
    helperPath = helperPath.replace('node_modules.asar', 'node_modules.asar.unpacked');
  }
}`;
    
    // Find and replace the helperPath section
    content = content.replace(
      /var helperPath;[\s\S]*?helperPath = helperPath\.replace\('node_modules\.asar', 'node_modules\.asar\.unpacked'\);/m,
      helperPathPatch
    );
    
    fs.writeFileSync(unixTerminalFile, content);
  }
  
  console.log('Patched node-pty to use process.dlopen() instead of require().');
}

async function main() {
  try {
    // Create build directory
    if (!fs.existsSync('build')) {
      fs.mkdirSync('build');
    }
    
    // Create native directory
    if (!fs.existsSync('native')) {
      fs.mkdirSync('native');
    }

    // 0. Patch node-pty
    patchNodePty();

    // 1. Bundle TypeScript with esbuild using custom loader
    console.log('Bundling TypeScript with esbuild...');
    const buildDate = new Date().toISOString();
    const buildTimestamp = Date.now();
    
    // Use esbuild directly without custom loader since we're patching node-pty
    const esbuildCmd = `npx esbuild src/cli.ts \\
      --bundle \\
      --platform=node \\
      --target=node20 \\
      --outfile=build/bundle.js \\
      --format=cjs \\
      --sourcemap=inline \\
      --source-root=/ \\
      --keep-names \\
      --define:process.env.BUILD_DATE='"${buildDate}"' \\
      --define:process.env.BUILD_TIMESTAMP='"${buildTimestamp}"'`;
    
    console.log('Running:', esbuildCmd);
    execSync(esbuildCmd, { stdio: 'inherit' });

    // 2. Create SEA configuration
    console.log('\nCreating SEA configuration...');
    const seaConfig = {
      main: 'build/bundle.js',
      output: 'build/sea-prep.blob',
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false
    };
    
    fs.writeFileSync('build/sea-config.json', JSON.stringify(seaConfig, null, 2));

    // 3. Generate SEA blob
    console.log('Generating SEA blob...');
    execSync('node --experimental-sea-config build/sea-config.json', { stdio: 'inherit' });

    // 4. Create executable
    console.log('\nCreating executable...');
    const nodeExe = process.execPath;
    const targetExe = process.platform === 'win32' ? 'native/vibetunnel.exe' : 'native/vibetunnel';
    
    // Copy node binary
    fs.copyFileSync(nodeExe, targetExe);
    if (process.platform !== 'win32') {
      fs.chmodSync(targetExe, 0o755);
    }

    // 5. Inject the blob
    console.log('Injecting SEA blob...');
    let postjectCmd = `npx postject ${targetExe} NODE_SEA_BLOB build/sea-prep.blob \\
      --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`;
    
    if (process.platform === 'darwin') {
      postjectCmd += ' --macho-segment-name NODE_SEA';
    }
    
    execSync(postjectCmd, { stdio: 'inherit' });

    // 6. Sign on macOS
    if (process.platform === 'darwin') {
      console.log('Signing executable...');
      execSync(`codesign --sign - ${targetExe}`, { stdio: 'inherit' });
    }

    // 7. Restore original node-pty
    console.log('Restoring original node-pty...');
    execSync('rm -rf node_modules/@homebridge/node-pty-prebuilt-multiarch', { stdio: 'inherit' });
    execSync('npm install @homebridge/node-pty-prebuilt-multiarch --silent --no-fund --no-audit', { stdio: 'inherit' });

    // 8. Copy only necessary native files
    console.log('Copying native modules...');
    const nativeModulesDir = 'node_modules/@homebridge/node-pty-prebuilt-multiarch/build/Release';
    
    // Copy pty.node
    fs.copyFileSync(
      path.join(nativeModulesDir, 'pty.node'),
      'native/pty.node'
    );
    console.log('  - Copied pty.node');
    
    // Copy spawn-helper (Unix only)
    if (process.platform !== 'win32') {
      fs.copyFileSync(
        path.join(nativeModulesDir, 'spawn-helper'),
        'native/spawn-helper'
      );
      fs.chmodSync('native/spawn-helper', 0o755);
      console.log('  - Copied spawn-helper');
    }

    // 9. Clean up
    console.log('\nCleaning up...');
    fs.rmSync('build', { recursive: true, force: true });

    console.log('\n✅ Build complete!');
    console.log(`\nPortable executable created in native/ directory:`);
    console.log(`  - vibetunnel (executable)`);
    console.log(`  - pty.node`);
    if (process.platform !== 'win32') {
      console.log(`  - spawn-helper`);
    }
    console.log('\nAll files must be kept together in the same directory.');
    console.log('This bundle will work on any machine with the same OS/architecture.');
    
  } catch (error) {
    console.error('\n❌ Build failed:', error.message);
    process.exit(1);
  }
}

main();