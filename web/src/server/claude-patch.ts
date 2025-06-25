import { spawn } from 'child_process';
import * as fs from 'fs';

/**
 * Patches Claude Code to allow running it under a debugger by launching it
 * through Node.js with the --inspect flag.
 *
 * Based on the technique used in claude-trace to intercept Claude's execution.
 */
export function patchClaude(
  claudePath: string,
  args: string[] = [],
  options: {
    inspect?: boolean;
    inspectPort?: number;
    inspectBrk?: boolean;
  } = {}
): void {
  // Verify Claude executable exists
  if (!fs.existsSync(claudePath)) {
    throw new Error(`Claude executable not found at: ${claudePath}`);
  }

  // Build Node.js arguments
  const nodeArgs: string[] = [];

  // Add debugging flags if requested
  if (options.inspect || options.inspectBrk) {
    const port = options.inspectPort || 9229;
    if (options.inspectBrk) {
      nodeArgs.push(`--inspect-brk=${port}`);
    } else {
      nodeArgs.push(`--inspect=${port}`);
    }
  }

  // Add Claude path and its arguments
  nodeArgs.push(claudePath, ...args);

  // Launch Claude through Node.js
  const child = spawn('node', nodeArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      // Disable deprecation warnings for cleaner output
      NODE_OPTIONS: '--no-deprecation',
    },
  });

  // Forward signals to the child process
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  for (const signal of signals) {
    process.on(signal, () => {
      if (!child.killed) {
        child.kill(signal);
      }
    });
  }

  // Exit with same code as Claude
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code || 0);
    }
  });

  child.on('error', (error) => {
    console.error('Failed to start Claude:', error);
    process.exit(1);
  });
}

/**
 * Example usage:
 *
 * // Run Claude normally
 * patchClaude('/path/to/claude', ['chat']);
 *
 * // Run Claude with debugger attached
 * patchClaude('/path/to/claude', ['chat'], { inspect: true });
 *
 * // Run Claude with debugger and break on start
 * patchClaude('/path/to/claude', ['chat'], { inspectBrk: true, inspectPort: 9229 });
 */
