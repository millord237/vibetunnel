/**
 * ProcessUtils - Cross-platform process management utilities
 *
 * Provides reliable process existence checking across Windows, macOS, and Linux.
 */

import { spawnSync } from 'child_process';
import { createLogger } from '../utils/logger.js';
import chalk from 'chalk';

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
}
