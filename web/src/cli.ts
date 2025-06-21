#!/usr/bin/env node
// Entry point for the server - imports the modular server which starts automatically
import { startVibeTunnelForward } from './server/fwd.js';
import { startVibeTunnelServer } from './server/server.js';
import { VERSION } from './server/version.js';

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

if (process.argv[2] === 'version') {
  console.log(`VibeTunnel Linux v${VERSION}`);
  process.exit(0);
} else if (process.argv[2] === 'fwd') {
  startVibeTunnelForward(process.argv.slice(3)).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
} else {
  startVibeTunnelServer();
}
