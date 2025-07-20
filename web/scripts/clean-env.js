#!/usr/bin/env node

/**
 * Clean Environment Wrapper
 * Ensures commands run with a clean environment, free from SEA mode issues
 */

import { spawn } from 'child_process';

// Remove problematic environment variables
const cleanEnv = { ...process.env };
delete cleanEnv.VIBETUNNEL_SEA;

// Set development mode if not in build
if (!cleanEnv.VIBETUNNEL_BUILD && cleanEnv.NODE_ENV === 'production') {
  cleanEnv.NODE_ENV = 'development';
}

// Get command and arguments
const [, , ...args] = process.argv;

if (args.length === 0) {
  console.error('Usage: clean-env <command> [...args]');
  process.exit(1);
}

// Spawn the command with clean environment
const child = spawn(args[0], args.slice(1), {
  env: cleanEnv,
  stdio: 'inherit',
  shell: true
});

// Forward exit code
child.on('exit', (code) => {
  process.exit(code || 0);
});

child.on('error', (err) => {
  console.error('Failed to execute command:', err);
  process.exit(1);
});