import chalk from 'chalk';
import { createApp } from './app.js';
import { setShuttingDown } from './services/shutdown-state.js';

// Export a function to start the server
export function startVibeTunnelServer() {
  // Create and configure the app
  const appInstance = createApp();
  const { startServer, server, terminalManager, remoteRegistry, hqClient, controlDirWatcher } =
    appInstance;

  startServer();

  // Cleanup old terminals every 5 minutes
  setInterval(
    () => {
      terminalManager.cleanup(5 * 60 * 1000); // 5 minutes
    },
    5 * 60 * 1000
  );

  // Graceful shutdown
  let isShuttingDown = false;

  const shutdown = async () => {
    if (isShuttingDown) {
      console.log(chalk.red('Force exit...'));
      process.exit(1);
    }

    isShuttingDown = true;
    setShuttingDown(true);
    console.log(chalk.yellow('\nShutting down...'));

    try {
      // Stop control directory watcher
      if (controlDirWatcher) {
        controlDirWatcher.stop();
      }

      if (hqClient) {
        await hqClient.destroy();
      }

      if (remoteRegistry) {
        remoteRegistry.destroy();
      }

      server.close(() => {
        console.log(chalk.green('Server closed successfully'));
        process.exit(0);
      });

      // Force exit after 5 seconds if graceful shutdown fails
      setTimeout(() => {
        console.log(chalk.red('Graceful shutdown timeout, forcing exit...'));
        process.exit(1);
      }, 5000);
    } catch (error) {
      console.error(chalk.red('Error during shutdown:'), error);
      process.exit(1);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Only start server if this is the main module (for backward compatibility)
// When running with tsx, the main module check is different
// NOTE: When bundled as 'vibetunnel' executable, index.ts handles the startup
const isMainModule =
  process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server/index.ts');
if (isMainModule) {
  startVibeTunnelServer();
}

// Export for testing
export * from './app.js';
