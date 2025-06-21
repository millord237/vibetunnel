#!/usr/bin/env node

/**
 * Build standalone vibetunnel executable with native modules
 * 
 * Note: Bun does not support universal binaries. This builds for the native architecture only.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Building standalone vibetunnel executable for native architecture...');
console.log('Note: Bun does not support universal binaries');

function patchNodePty() {
  console.log('Patching node-pty for standalone build...');

  // Patch prebuild-file-path.js to look next to executable
  const prebuildPathFile = path.join(__dirname, 'node_modules/@homebridge/node-pty-prebuilt-multiarch/lib/prebuild-file-path.js');
  const prebuildPathContent = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ptyPath = void 0;
var path = require("path");

// For bundled executables, look next to the binary
if (process.argv[0] === 'bun' && process.execPath.endsWith('vibetunnel')) {
  exports.ptyPath = path.join(path.dirname(process.execPath), 'pty.node');
} else {
  // Original prebuild logic
  var fs = require("fs");
  var os = require("os");
  function prebuildName() {
    var tags = [];
    tags.push(process.versions.hasOwnProperty('electron') ? 'electron' : 'node');
    tags.push('abi' + process.versions.modules);
    if (os.platform() === 'linux' && fs.existsSync('/etc/alpine-release')) {
      tags.push('musl');
    }
    return tags.join('.') + '.node';
  }
  var pathToBuild = path.resolve(__dirname, "../prebuilds/" + os.platform() + "-" + os.arch() + "/" + prebuildName());
  exports.ptyPath = fs.existsSync(pathToBuild) ? pathToBuild : null;
}
//# sourceMappingURL=prebuild-file-path.js.map`;

  fs.writeFileSync(prebuildPathFile, prebuildPathContent);

  // Also update unixTerminal.js
  const unixTerminalPath = path.join(__dirname, 'node_modules/@homebridge/node-pty-prebuilt-multiarch/lib/unixTerminal.js');
  let unixTerminal = fs.readFileSync(unixTerminalPath, 'utf8');

  // Add check for bundled executable after helperPath is set
  const helperPathInsert = `
// For bundled executables, look next to the binary
if (process.argv[0] === 'bun' && process.execPath.endsWith('vibetunnel')) {
  helperPath = path.join(path.dirname(process.execPath), 'spawn-helper');
} else {
  helperPath = path.resolve(__dirname, helperPath);
}`;

  // Find where to insert - after the helperPath assignment
  const resolveMatch = unixTerminal.match(/helperPath = path\.resolve\(__dirname, helperPath\);/);
  if (resolveMatch) {
    unixTerminal = unixTerminal.replace(
      'helperPath = path.resolve(__dirname, helperPath);',
      helperPathInsert
    );
  } else {
    // If already patched, look for the bundled check
    if (!unixTerminal.includes('process.execPath.endsWith')) {
      // Find the helperPath line and add our check
      const helperPathLine = unixTerminal.indexOf("helperPath = '../build/Release/spawn-helper';");
      if (helperPathLine !== -1) {
        const nextLineIndex = unixTerminal.indexOf('\n', helperPathLine) + 1;
        unixTerminal = unixTerminal.slice(0, nextLineIndex) + helperPathInsert + '\n' + unixTerminal.slice(nextLineIndex);
      }
    }
  }

  fs.writeFileSync(unixTerminalPath, unixTerminal);

  console.log('Patched node-pty to look for native files next to executable.');
}


console.log('Building standalone vibetunnel executable...');

try {
  // 1. Apply patches
  patchNodePty();

  // 2. Create native directory
  if (!fs.existsSync('native')) {
    fs.mkdirSync('native');
  }

  // 3. Compile with Bun
  console.log('Compiling with Bun...');
  const buildDate = new Date().toISOString();
  const buildTimestamp = Date.now();
  const compileCmd = `BUILD_DATE="${buildDate}" BUILD_TIMESTAMP="${buildTimestamp}" bun build src/cli.ts --compile --outfile native/vibetunnel`;
  
  console.log(`Running: ${compileCmd}`);
  console.log(`Build date: ${buildDate}`);
  execSync(compileCmd, { stdio: 'inherit', env: { ...process.env, BUILD_DATE: buildDate, BUILD_TIMESTAMP: buildTimestamp } });

  // 4. Copy native modules
  console.log('Creating native directory and copying modules...');
  const nativeModulesDir = 'node_modules/@homebridge/node-pty-prebuilt-multiarch/build/Release';
  
  fs.copyFileSync(
    path.join(nativeModulesDir, 'pty.node'),
    'native/pty.node'
  );
  
  fs.copyFileSync(
    path.join(nativeModulesDir, 'spawn-helper'),
    'native/spawn-helper'
  );

  // 5. Restore original node-pty
  console.log('Restoring original node-pty...');
  execSync('rm -rf node_modules/@homebridge/node-pty-prebuilt-multiarch', { stdio: 'inherit' });
  execSync('npm install @homebridge/node-pty-prebuilt-multiarch --silent --no-fund --no-audit', { stdio: 'inherit' }); // Added --no-fund --no-audit for cleaner output

  console.log('\nBuild complete!');
  console.log('');
  console.log('Standalone build created in native/ directory:');
  console.log('  - native/vibetunnel (executable)');
  console.log('  - native/pty.node');
  console.log('  - native/spawn-helper');
  console.log('');
  console.log('All three files must be in the same directory when running.');

} catch (error) {
  console.error('Build failed:');
  if (error.stderr) {
    console.error(error.stderr.toString());
  }
  if (error.stdout) {
    console.error(error.stdout.toString());
  }
  console.error(error.message);
  process.exit(1);
}