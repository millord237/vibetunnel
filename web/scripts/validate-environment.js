#!/usr/bin/env node

/**
 * Environment Validation Script
 * Run this to ensure your VibeTunnel environment is properly configured
 */

import chalk from 'chalk';
import { existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

let hasErrors = false;
let hasWarnings = false;

console.log(chalk.cyan.bold('\n🔍 VibeTunnel Environment Validator\n'));

// Check Node.js version
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1));
if (majorVersion < 18) {
  console.log(chalk.red(`❌ Node.js version ${nodeVersion} is too old. Requires Node.js 18 or later.`));
  hasErrors = true;
} else {
  console.log(chalk.green(`✅ Node.js version: ${nodeVersion}`));
}

// Check environment variables
console.log(chalk.yellow('\n📋 Environment Variables:'));

if (process.env.VIBETUNNEL_SEA) {
  console.log(chalk.red(`❌ VIBETUNNEL_SEA is set to '${process.env.VIBETUNNEL_SEA}'`));
  console.log(chalk.red('   This will cause native modules to fail loading!'));
  console.log(chalk.yellow('   Fix: unset VIBETUNNEL_SEA'));
  hasErrors = true;
} else {
  console.log(chalk.green('✅ VIBETUNNEL_SEA is not set (good)'));
}

if (process.env.NODE_ENV === 'production' && !process.env.VIBETUNNEL_BUILD) {
  console.log(chalk.yellow(`⚠️  NODE_ENV is 'production' but not in build mode`));
  console.log(chalk.yellow('   This might cause unexpected behavior in development'));
  hasWarnings = true;
} else {
  console.log(chalk.green(`✅ NODE_ENV: ${process.env.NODE_ENV || 'not set'}`));
}

// Check native modules
console.log(chalk.yellow('\n🔧 Native Modules:'));

const nativeModules = [
  {
    name: 'node-pty',
    files: [
      'node_modules/.pnpm/node-pty@file+node-pty/node_modules/node-pty/build/Release/pty.node',
      'node_modules/node-pty/build/Release/pty.node'
    ]
  },
  {
    name: 'spawn-helper',
    files: [
      'node_modules/.pnpm/node-pty@file+node-pty/node_modules/node-pty/build/Release/spawn-helper',
      'node_modules/node-pty/build/Release/spawn-helper'
    ]
  }
];

for (const module of nativeModules) {
  let found = false;
  let foundPath = '';
  
  for (const file of module.files) {
    const fullPath = join(projectRoot, file);
    if (existsSync(fullPath)) {
      found = true;
      foundPath = file;
      break;
    }
  }
  
  if (found) {
    console.log(chalk.green(`✅ ${module.name}: ${foundPath}`));
  } else {
    console.log(chalk.red(`❌ ${module.name}: Not found`));
    console.log(chalk.yellow('   Run: pnpm install'));
    hasErrors = true;
  }
}

// Test loading node-pty
console.log(chalk.yellow('\n🧪 Testing node-pty loading:'));

try {
  // Remove VIBETUNNEL_SEA for this test
  const originalSEA = process.env.VIBETUNNEL_SEA;
  delete process.env.VIBETUNNEL_SEA;
  
  const pty = await import('node-pty');
  console.log(chalk.green('✅ node-pty loaded successfully'));
  
  // Test spawning
  try {
    const testPty = pty.spawn('echo', ['test'], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.cwd()
    });
    testPty.kill();
    console.log(chalk.green('✅ PTY spawning works'));
  } catch (spawnError) {
    console.log(chalk.red('❌ PTY spawning failed:'), spawnError.message);
    hasErrors = true;
  }
  
  // Restore original value
  if (originalSEA) {
    process.env.VIBETUNNEL_SEA = originalSEA;
  }
} catch (error) {
  console.log(chalk.red('❌ Failed to load node-pty:'), error.message);
  hasErrors = true;
}

// Check package.json scripts
console.log(chalk.yellow('\n📦 Package Scripts:'));
try {
  const packageJson = await import(join(projectRoot, 'package.json'), { assert: { type: 'json' } });
  const scripts = packageJson.default.scripts;
  
  const requiredScripts = ['dev', 'build', 'test', 'lint', 'format'];
  for (const script of requiredScripts) {
    if (scripts[script]) {
      console.log(chalk.green(`✅ ${script}: ${scripts[script]}`));
    } else {
      console.log(chalk.yellow(`⚠️  ${script}: Not found`));
      hasWarnings = true;
    }
  }
} catch (error) {
  console.log(chalk.red('❌ Failed to read package.json'));
  hasErrors = true;
}

// Summary
console.log(chalk.cyan.bold('\n📊 Summary:'));
if (hasErrors) {
  console.log(chalk.red(`❌ Found errors that need to be fixed`));
  process.exit(1);
} else if (hasWarnings) {
  console.log(chalk.yellow(`⚠️  Environment is functional but has warnings`));
  process.exit(0);
} else {
  console.log(chalk.green(`✅ Environment is properly configured!`));
  process.exit(0);
}