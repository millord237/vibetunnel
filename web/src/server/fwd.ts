#!/usr/bin/env npx tsx --no-deprecation

/**
 * VibeTunnel Forward (fwd.ts)
 *
 * A simple command-line tool that spawns a PTY session and forwards it
 * using the VibeTunnel PTY infrastructure.
 *
 * Usage:
 *   npx tsx src/fwd.ts <command> [args...]
 *   npx tsx src/fwd.ts claude --resume
 */

import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import { PtyManager } from './pty/index.js';
import { VERSION, BUILD_DATE, GIT_COMMIT } from './version.js';
import { createLogger, closeLogger } from './utils/logger.js';

const logger = createLogger('fwd');

function showUsage() {
  logger.log('VibeTunnel Forward (fwd.ts)');
  logger.log('');
  logger.log('Usage:');
  logger.log('  npx tsx src/fwd.ts [--session-id <id>] <command> [args...]');
  logger.log('');
  logger.log('Options:');
  logger.log('  --session-id <id>   Use a pre-generated session ID');
  logger.log('');
  logger.log('Examples:');
  logger.log('  npx tsx src/fwd.ts claude --resume');
  logger.log('  npx tsx src/fwd.ts bash -l');
  logger.log('  npx tsx src/fwd.ts python3 -i');
  logger.log('  npx tsx src/fwd.ts --session-id abc123 claude');
  logger.log('');
  logger.log('The command will be spawned in the current working directory');
  logger.log('and managed through the VibeTunnel PTY infrastructure.');
}

export async function startVibeTunnelForward(args: string[]) {
  // Log startup with version (logger already initialized in cli.ts)
  logger.log(chalk.blue(`VibeTunnel Forward v${VERSION}`) + chalk.gray(` (${BUILD_DATE})`));
  if (args.includes('--debug')) {
    logger.debug('Debug mode enabled');
  }

  // Parse command line arguments
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showUsage();
    closeLogger();
    process.exit(0);
  }

  // Check for --session-id parameter
  let sessionId: string | undefined;
  let remainingArgs = args;

  if (args[0] === '--session-id' && args.length > 1) {
    sessionId = args[1];
    remainingArgs = args.slice(2);
  }

  const command = remainingArgs;

  if (command.length === 0) {
    logger.error('No command specified');
    showUsage();
    closeLogger();
    process.exit(1);
  }

  const cwd = process.cwd();

  // Initialize PTY manager
  const controlPath = path.join(os.homedir(), '.vibetunnel', 'control');
  logger.debug(`Control path: ${controlPath}`);
  const ptyManager = new PtyManager(controlPath);

  try {
    // Create the session
    const sessionName = `fwd_${command[0]}_${Date.now()}`;

    // Pre-generate session ID if not provided
    const finalSessionId = sessionId || `fwd_${Date.now()}`;

    logger.log(`Creating session for command: ${command.join(' ')}`);
    logger.debug(`Session ID: ${finalSessionId}, working directory: ${cwd}`);

    const result = await ptyManager.createSession(command, {
      sessionId: finalSessionId,
      name: sessionName,
      workingDir: cwd,
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
      forwardToStdout: true,
      onExit: async (exitCode: number) => {
        // Show exit message
        logger.log(
          chalk.yellow(`\n✓ VibeTunnel session ended`) + chalk.gray(` (exit code: ${exitCode})`)
        );

        // Restore terminal settings and clean up stdin
        if (process.stdin.isTTY) {
          logger.debug('Restoring terminal to normal mode');
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();
        process.stdin.removeAllListeners();

        // Destroy stdin to ensure it doesn't keep the process alive
        if (process.stdin.destroy) {
          process.stdin.destroy();
        }

        // Shutdown PTY manager and exit
        logger.debug('Shutting down PTY manager');
        await ptyManager.shutdown();

        // Force exit
        closeLogger();
        process.exit(exitCode || 0);
      },
    });

    // Get session info
    const session = ptyManager.getSession(result.sessionId);
    if (!session) {
      throw new Error('Session not found after creation');
    }
    // Log session info with version
    logger.log(chalk.green(`✓ VibeTunnel session started`) + chalk.gray(` (v${VERSION})`));
    logger.log(chalk.gray('Command:'), command.join(' '));
    logger.log(chalk.gray('Control directory:'), path.join(controlPath, result.sessionId));
    logger.log(chalk.gray('Build:'), `${BUILD_DATE} | Commit: ${GIT_COMMIT}`);

    // Set up raw mode for terminal input
    if (process.stdin.isTTY) {
      logger.debug('Setting terminal to raw mode for input forwarding');
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    // The process will stay alive because stdin is in raw mode and resumed
  } catch (error) {
    logger.error('Failed to create or manage session:', error);

    closeLogger();
    process.exit(1);
  }
}
