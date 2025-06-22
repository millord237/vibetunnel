#!/usr/bin/env node
// Entry point for the server - imports the modular server which starts automatically
import { startVibeTunnelForward } from './server/fwd.js';
import { startVibeTunnelServer } from './server/server.js';
import { VERSION } from './server/version.js';

// Source maps are only included if built with --sourcemap flag

// Prevent double execution in SEA context where require.main might be undefined
// Use a global flag to ensure we only run once
if ((global as any).__vibetunnelStarted) {
  process.exit(0);
}
(global as any).__vibetunnelStarted = true;

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  console.error('Stack trace:', error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  if (reason instanceof Error) {
    console.error('Stack trace:', reason.stack);
  }
  process.exit(1);
});

// Only execute if this is the main module (or in SEA where require.main is undefined)
if (!module.parent && (require.main === module || require.main === undefined)) {
  if (process.argv[2] === 'version') {
    console.log(`VibeTunnel Server v${VERSION}`);
    process.exit(0);
  } else if (process.argv[2] === 'fwd') {
    startVibeTunnelForward(process.argv.slice(3)).catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
  } else {
    console.log('Starting VibeTunnel server...');
    startVibeTunnelServer();
  }
}
