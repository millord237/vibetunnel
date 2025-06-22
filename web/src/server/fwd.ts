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

function showUsage() {
  console.log('VibeTunnel Forward (fwd.ts)');
  console.log('');
  console.log('Usage:');
  console.log('  npx tsx src/fwd.ts [--session-id <id>] <command> [args...]');
  console.log('');
  console.log('Options:');
  console.log('  --session-id <id>   Use a pre-generated session ID');
  console.log('');
  console.log('Examples:');
  console.log('  npx tsx src/fwd.ts claude --resume');
  console.log('  npx tsx src/fwd.ts bash -l');
  console.log('  npx tsx src/fwd.ts python3 -i');
  console.log('  npx tsx src/fwd.ts --session-id abc123 claude');
  console.log('');
  console.log('The command will be spawned in the current working directory');
  console.log('and managed through the VibeTunnel PTY infrastructure.');
}

export async function startVibeTunnelForward(args: string[]) {
  // Parse command line arguments
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    showUsage();
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
    console.error('Error: No command specified');
    showUsage();
    process.exit(1);
  }

  const cwd = process.cwd();

  // Initialize PTY manager
  const controlPath = path.join(os.homedir(), '.vibetunnel', 'control');
  const ptyManager = new PtyManager(controlPath);

  try {
    // Create the session
    const sessionName = `fwd_${command[0]}_${Date.now()}`;

    // Pre-generate session ID if not provided
    const finalSessionId = sessionId || `fwd_${Date.now()}`;

    const result = await ptyManager.createSession(command, {
      sessionId: finalSessionId,
      name: sessionName,
      workingDir: cwd,
      cols: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
      forwardToStdout: true,
      onExit: async (exitCode: number) => {
        // Show exit message
        console.log(chalk.yellow('\n✓ VibeTunnel session ended'));

        // Restore terminal settings and clean up stdin
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.pause();
        process.stdin.removeAllListeners();

        // Destroy stdin to ensure it doesn't keep the process alive
        if (process.stdin.destroy) {
          process.stdin.destroy();
        }

        // Shutdown PTY manager and exit
        await ptyManager.shutdown();

        // Force exit
        process.exit(exitCode || 0);
      },
    });

    // Get session info
    const session = ptyManager.getSession(result.sessionId);
    if (!session) {
      throw new Error('Session not found after creation');
    }
    // Log session info with version
    console.log(chalk.green(`✓ VibeTunnel session started`) + chalk.gray(` (v${VERSION})`));
    console.log(chalk.gray('Command:'), command.join(' '));
    console.log(chalk.gray('Control directory:'), path.join(controlPath, result.sessionId));
    console.log(chalk.gray('Build:'), `${BUILD_DATE} | Commit: ${GIT_COMMIT}`);

    // Set up raw mode for terminal input
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    // The process will stay alive because stdin is in raw mode and resumed
  } catch (error) {
    console.error('Failed to create or manage session:', error);

    if (error instanceof Error) {
      console.error('Error details:', error.message);
    }

    process.exit(1);
  }
}
