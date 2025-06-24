/**
 * ProcessUtils - Cross-platform process management utilities
 *
 * Provides reliable process existence checking across Windows, macOS, and Linux.
 */

import { spawnSync } from 'child_process';
import { createLogger } from '../utils/logger.js';
import chalk from 'chalk';
import * as os from 'os';
import * as path from 'path';

const logger = createLogger('process-utils');

export class ProcessUtils {
  /**
   * Check if a process is currently running by PID
   * Uses platform-appropriate methods for reliable detection
   */
  static isProcessRunning(pid: number): boolean {
    if (!pid || pid <= 0) {
      return false;
    }

    try {
      if (process.platform === 'win32') {
        // Windows: Use tasklist command
        return ProcessUtils.isProcessRunningWindows(pid);
      } else {
        // Unix/Linux/macOS: Use kill with signal 0
        return ProcessUtils.isProcessRunningUnix(pid);
      }
    } catch (error) {
      logger.warn(`error checking if process ${pid} is running:`, error);
      return false;
    }
  }

  /**
   * Windows-specific process check using tasklist
   */
  private static isProcessRunningWindows(pid: number): boolean {
    try {
      logger.debug(`checking windows process ${pid} with tasklist`);
      const result = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000, // 5 second timeout
      });

      // Check if the command succeeded and PID appears in output
      if (result.status === 0 && result.stdout) {
        // tasklist outputs CSV format with PID in quotes
        const exists = result.stdout.includes(`"${pid}"`);
        logger.debug(`process ${pid} exists: ${exists}`);
        return exists;
      }

      logger.debug(`tasklist command failed with status ${result.status}`);
      return false;
    } catch (error) {
      logger.warn(`windows process check failed for PID ${pid}:`, error);
      return false;
    }
  }

  /**
   * Unix-like systems process check using kill signal 0
   */
  private static isProcessRunningUnix(pid: number): boolean {
    try {
      // Send signal 0 to check if process exists
      // This doesn't actually kill the process, just checks existence
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // If we get ESRCH, the process doesn't exist
      // If we get EPERM, the process exists but we don't have permission
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EPERM') {
        // Process exists but we don't have permission to signal it
        return true;
      }
      // ESRCH or other errors mean process doesn't exist
      return false;
    }
  }

  /**
   * Get basic process information if available
   * Returns null if process is not running or info cannot be retrieved
   */
  static getProcessInfo(pid: number): { pid: number; exists: boolean } | null {
    if (!ProcessUtils.isProcessRunning(pid)) {
      return null;
    }

    return {
      pid,
      exists: true,
    };
  }

  /**
   * Kill a process with platform-appropriate method
   * Returns true if the kill signal was sent successfully
   */
  static killProcess(pid: number, signal: NodeJS.Signals | number = 'SIGTERM'): boolean {
    if (!pid || pid <= 0) {
      return false;
    }

    logger.debug(`attempting to kill process ${pid} with signal ${signal}`);

    try {
      if (process.platform === 'win32') {
        // Windows: Use taskkill command for more reliable termination
        const result = spawnSync('taskkill', ['/PID', pid.toString(), '/F'], {
          windowsHide: true,
          timeout: 5000,
        });
        if (result.status === 0) {
          logger.log(chalk.green(`process ${pid} killed successfully`));
          return true;
        } else {
          logger.debug(`taskkill failed with status ${result.status}`);
          return false;
        }
      } else {
        // Unix-like: Use built-in process.kill
        process.kill(pid, signal);
        logger.log(chalk.green(`signal ${signal} sent to process ${pid}`));
        return true;
      }
    } catch (error) {
      logger.warn(`error killing process ${pid}:`, error);
      return false;
    }
  }

  /**
   * Wait for a process to exit with timeout
   * Returns true if process exited within timeout, false otherwise
   */
  static async waitForProcessExit(pid: number, timeoutMs: number = 5000): Promise<boolean> {
    const startTime = Date.now();
    const checkInterval = 100; // Check every 100ms

    logger.debug(`waiting for process ${pid} to exit (timeout: ${timeoutMs}ms)`);

    while (Date.now() - startTime < timeoutMs) {
      if (!ProcessUtils.isProcessRunning(pid)) {
        const elapsed = Date.now() - startTime;
        logger.log(chalk.green(`process ${pid} exited after ${elapsed}ms`));
        return true;
      }
      await new Promise((resolve) => setTimeout(resolve, checkInterval));
    }

    logger.log(chalk.yellow(`process ${pid} did not exit within ${timeoutMs}ms timeout`));
    return false;
  }

  /**
   * Check if this is an interactive shell session
   */
  private static isInteractiveShellCommand(cmdName: string, args: string[]): boolean {
    // Common shells
    const shells = ['bash', 'zsh', 'sh', 'fish', 'dash', 'ksh', 'tcsh', 'csh'];
    const isShell = shells.some((shell) => cmdName === shell || cmdName.endsWith(`/${shell}`));

    if (!isShell) return false;

    // Check for interactive flags
    const interactiveFlags = ['-i', '--interactive', '-l', '--login'];

    // If no args, it's interactive by default
    if (args.length === 0) return true;

    // Check if any args indicate interactive mode
    return args.some((arg) => interactiveFlags.includes(arg));
  }

  /**
   * Resolve a command to determine how to spawn it
   * Handles executables, aliases, shell builtins, and interactive shells
   * Returns everything needed to spawn the PTY correctly
   */
  static resolveCommand(command: string[]): {
    command: string;
    args: string[];
    useShell: boolean;
    isInteractive: boolean;
    resolvedFrom?: 'path' | 'alias' | 'builtin' | 'shell';
    originalCommand?: string;
  } {
    if (command.length === 0) {
      throw new Error('No command provided');
    }

    const cmdName = command[0];
    const cmdArgs = command.slice(1);

    // First, check if this is an interactive shell request
    if (ProcessUtils.isInteractiveShellCommand(cmdName, cmdArgs)) {
      logger.debug(`Interactive shell requested: ${cmdName}`);
      return {
        command: cmdName,
        args: cmdArgs,
        useShell: false,
        isInteractive: true,
        resolvedFrom: 'shell',
      };
    }

    // Try to resolve as a regular executable first
    const executablePath = ProcessUtils.resolveExecutablePath(cmdName);
    if (executablePath) {
      logger.debug(`Command '${cmdName}' found at: ${executablePath}`);
      return {
        command: executablePath,
        args: cmdArgs,
        useShell: false,
        isInteractive: false,
        resolvedFrom: 'path',
        originalCommand: cmdName !== executablePath ? cmdName : undefined,
      };
    }

    // Not in PATH - try to resolve as an alias
    const aliasValue = ProcessUtils.getAliasValue(cmdName);
    if (aliasValue) {
      // Just use interactive shell to run the full command with the alias
      logger.log(chalk.cyan(`Using alias '${cmdName}' → '${aliasValue}'`));
      const userShell = ProcessUtils.getUserShell();
      const fullCommand = cmdArgs.length > 0 ? `${cmdName} ${cmdArgs.join(' ')}` : cmdName;
      return {
        command: userShell,
        args: ['-i', '-c', fullCommand],
        useShell: true,
        isInteractive: false,
        resolvedFrom: 'alias',
        originalCommand: cmdName,
      };
    }

    // Not an executable or alias - probably a shell builtin or function
    // For commands not found, we need interactive shell to load aliases
    logger.debug(`Command '${cmdName}' not found in PATH or aliases, using interactive shell`);
    const userShell = ProcessUtils.getUserShell();
    return {
      command: userShell,
      args: ['-i', '-c', command.join(' ')],
      useShell: true,
      isInteractive: false,
      resolvedFrom: 'builtin',
      originalCommand: cmdName,
    };
  }

  /**
   * Resolve an executable path using 'which' command
   * Returns the absolute path if found, null otherwise
   */
  private static resolveExecutablePath(executable: string): string | null {
    // If already an absolute path, return as is
    if (path.isAbsolute(executable)) {
      return executable;
    }

    // If it's a relative path with directory separators, resolve it
    if (executable.includes('/') || executable.includes('\\')) {
      return path.resolve(executable);
    }

    // Use 'which' to find the executable in PATH
    const whichCommand = process.platform === 'win32' ? 'where' : 'which';
    try {
      const result = spawnSync(whichCommand, [executable], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 2000,
      });

      if (result.status === 0 && result.stdout && result.stdout.trim()) {
        return result.stdout.trim().split('\n')[0]; // Take first result on Windows
      }
    } catch (error) {
      logger.debug(`Failed to resolve executable '${executable}':`, error);
    }

    return null;
  }

  /**
   * Get the raw alias value for a command
   * Returns null if not an alias
   */
  private static getAliasValue(aliasName: string): string | null {
    try {
      // Get the user's shell to check aliases
      const userShell = process.env.SHELL || '/bin/bash';

      // Get all aliases from the user's shell
      const aliasListCommand = `${userShell} -i -c "alias"`;
      const aliasOutput = spawnSync(aliasListCommand, {
        encoding: 'utf8',
        shell: true,
        timeout: 2000,
      });

      if (aliasOutput.status !== 0 || !aliasOutput.stdout) {
        return null;
      }

      // Parse the alias output (format: alias key='value')
      const lines = aliasOutput.stdout.split('\n');
      for (const line of lines) {
        // Match pattern: alias name='command' or alias name="command"
        const match = line.match(/^alias\s+([^=]+)=(['"]?)(.+)\2$/);
        if (match && match[1] === aliasName) {
          // Return the value with quotes stripped
          return match[3];
        }
      }
    } catch (error) {
      logger.debug(`Failed to get alias value for '${aliasName}':`, error);
    }

    return null;
  }

  /**
   * Get the user's preferred shell
   * Falls back to sensible defaults if SHELL env var is not set
   */
  static getUserShell(): string {
    // First try SHELL environment variable (most reliable on Unix)
    if (process.env.SHELL) {
      return process.env.SHELL;
    }

    // Platform-specific defaults
    if (process.platform === 'win32') {
      // Check for modern shells first

      // 1. Check for PowerShell Core (pwsh) - cross-platform version
      try {
        const result = spawnSync('pwsh', ['-Command', 'echo test'], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 1000,
        });
        if (result.status === 0) {
          return 'pwsh';
        }
      } catch (_) {
        // PowerShell Core not available
      }

      // 2. Check for Windows PowerShell (older, Windows-only)
      const powershellPath = path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      );
      try {
        const result = spawnSync(powershellPath, ['-Command', 'echo test'], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 1000,
        });
        if (result.status === 0) {
          return powershellPath;
        }
      } catch (_) {
        // PowerShell not available
      }

      // 3. Check for Git Bash if available
      const gitBashPaths = [
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'),
      ];
      for (const gitBashPath of gitBashPaths) {
        try {
          const result = spawnSync(gitBashPath, ['-c', 'echo test'], {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 1000,
          });
          if (result.status === 0) {
            return gitBashPath;
          }
        } catch (_) {
          // Git Bash not at this location
        }
      }

      // 4. Fall back to cmd.exe
      return process.env.ComSpec || 'cmd.exe';
    } else {
      // Unix-like systems
      // Node.js os.userInfo() includes shell on some platforms
      try {
        const userInfo = os.userInfo();
        if ('shell' in userInfo && userInfo.shell) {
          return userInfo.shell as string;
        }
      } catch (_) {
        // userInfo might fail in some environments
      }

      // Check common shell paths in order of preference
      const commonShells = ['/bin/zsh', '/bin/bash', '/usr/bin/zsh', '/usr/bin/bash', '/bin/sh'];
      for (const shell of commonShells) {
        try {
          // Just check if the shell exists and is executable
          const result = spawnSync('test', ['-x', shell], {
            encoding: 'utf8',
            timeout: 500,
          });
          if (result.status === 0) {
            return shell;
          }
        } catch (_) {
          // test command failed, try next shell
        }
      }

      // Final fallback - /bin/sh should always exist on Unix
      return '/bin/sh';
    }
  }
}
