import chalk from 'chalk';
import { createApp } from './app.js';

// Create and configure the app
const appInstance = createApp();
const { startServer, server, terminalManager, remoteRegistry, hqClient, controlDirWatcher } =
  appInstance;

// Only start server if this is the main module
// When running with tsx, the main module check is different
const isMainModule =
  process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server/index.ts');
if (isMainModule) {
  startServer();

  // Cleanup old terminals every 5 minutes
  setInterval(
    () => {
      terminalManager.cleanup(30 * 60 * 1000); // 30 minutes
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

// Export for testing
export * from './app.js';
