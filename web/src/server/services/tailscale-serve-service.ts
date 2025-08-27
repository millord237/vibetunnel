import { type ChildProcess, spawn } from 'child_process';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('tailscale-serve');

export interface TailscaleServeService {
  start(port: number): Promise<void>;
  stop(): Promise<void>;
  isRunning(): boolean;
  getStatus(): Promise<TailscaleServeStatus>;
}

export interface TailscaleServeStatus {
  isRunning: boolean;
  port?: number;
  error?: string;
  lastError?: string;
  startTime?: Date;
  isPermanentlyDisabled?: boolean;
}

/**
 * Service to manage Tailscale Serve as a background process
 */
export class TailscaleServeServiceImpl implements TailscaleServeService {
  private serveProcess: ChildProcess | null = null;
  private currentPort: number | null = null;
  private isStarting = false;
  private tailscaleExecutable = 'tailscale'; // Default to PATH lookup
  private lastError: string | undefined;
  private startTime: Date | undefined;
  private isPermanentlyDisabled = false;

  async start(port: number): Promise<void> {
    if (this.isPermanentlyDisabled) {
      throw new Error('Tailscale Serve is permanently disabled on this tailnet');
    }

    if (this.isStarting) {
      throw new Error('Tailscale Serve is already starting');
    }

    if (this.serveProcess) {
      logger.info('Tailscale Serve is already running, stopping first...');
      await this.stop();
    }

    this.isStarting = true;
    this.lastError = undefined; // Clear previous errors
    this.currentPort = port; // Set the port even if start fails

    try {
      // Check if tailscale command is available
      await this.checkTailscaleAvailable();

      // First, reset any existing serve configuration
      try {
        logger.debug('Resetting Tailscale Serve configuration...');
        const resetProcess = spawn(this.tailscaleExecutable, ['serve', 'reset'], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        await new Promise<void>((resolve) => {
          resetProcess.on('exit', () => resolve());
          resetProcess.on('error', () => resolve()); // Continue even if reset fails
          setTimeout(resolve, 1000); // Timeout after 1 second
        });
      } catch (_error) {
        logger.debug('Failed to reset serve config (this is normal if none exists)');
      }

      // TCP port: tailscale serve port
      const args = ['serve', port.toString()];
      logger.info(`Starting Tailscale Serve on port ${port}`);
      logger.debug(`Command: ${this.tailscaleExecutable} ${args.join(' ')}`);
      this.currentPort = port;

      // Start the serve process
      this.serveProcess = spawn(this.tailscaleExecutable, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false, // Keep it attached to our process
      });

      // Handle process events
      this.serveProcess.on('error', (error) => {
        logger.error(`Tailscale Serve process error: ${error.message}`);
        this.lastError = error.message;
        this.cleanup();
      });

      this.serveProcess.on('exit', (code, signal) => {
        logger.info(`Tailscale Serve process exited with code ${code}, signal ${signal}`);
        if (code !== 0) {
          // Check if this is the common "Serve not enabled" error
          if (this.lastError?.includes('Serve is not enabled on your tailnet')) {
            // Keep the more user-friendly error message we set in stderr handler
            logger.info('Tailscale Serve failed due to tailnet permissions');
          } else {
            this.lastError = `Process exited with code ${code}`;
          }
        }
        this.cleanup();
      });

      // Log stdout/stderr
      if (this.serveProcess.stdout) {
        this.serveProcess.stdout.on('data', (data) => {
          logger.debug(`Tailscale Serve stdout: ${data.toString().trim()}`);
        });
      }

      if (this.serveProcess.stderr) {
        this.serveProcess.stderr.on('data', (data) => {
          const stderr = data.toString().trim();
          logger.debug(`Tailscale Serve stderr: ${stderr}`);

          // Handle specific "Serve not enabled on tailnet" error
          if (stderr.includes('Serve is not enabled on your tailnet')) {
            logger.warn(
              'Tailscale Serve is not enabled on this tailnet - marking as permanently disabled'
            );
            this.lastError = 'Tailscale Serve feature not enabled on your tailnet';
            this.isPermanentlyDisabled = true;
            return;
          }

          // Capture other common error patterns
          if (stderr.includes('error') || stderr.includes('failed')) {
            this.lastError = stderr;
          }
        });
      }

      // Wait a moment to see if it starts successfully
      await new Promise<void>((resolve, reject) => {
        let settled = false;

        const settlePromise = (isSuccess: boolean, error?: Error | string) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);

          if (isSuccess) {
            logger.info('Tailscale Serve started successfully');
            this.startTime = new Date();
            resolve();
          } else {
            const errorMessage =
              error instanceof Error ? error.message : error || 'Tailscale Serve failed to start';
            this.lastError = errorMessage;
            reject(new Error(errorMessage));
          }
        };

        const timeout = setTimeout(() => {
          if (this.serveProcess && !this.serveProcess.killed) {
            settlePromise(true);
          } else {
            settlePromise(false, this.lastError);
          }
        }, 3000); // Wait 3 seconds

        if (this.serveProcess) {
          this.serveProcess.once('error', (error) => {
            settlePromise(false, error);
          });

          this.serveProcess.once('exit', (code) => {
            // For 'tailscale serve', exit code 0 means successful configuration
            // The command exits after setting up the proxy configuration
            if (code === 0) {
              logger.info('Tailscale Serve configured successfully (exit code 0)');
              // Give the configuration a moment to take effect before checking status
              setTimeout(() => {
                settlePromise(true); // SUCCESS - proxy is configured
              }, 100);
            } else {
              settlePromise(false, `Tailscale Serve failed with exit code ${code}`);
            }
          });
        }
      });
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.cleanup();
      throw error;
    } finally {
      this.isStarting = false;
    }
  }

  async stop(): Promise<void> {
    // First try to remove the serve configuration
    try {
      logger.debug('Removing Tailscale Serve configuration...');

      // Use 'reset' to completely clear all serve configuration
      const resetProcess = spawn(this.tailscaleExecutable, ['serve', 'reset'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      await new Promise<void>((resolve) => {
        resetProcess.on('exit', (code) => {
          if (code === 0) {
            logger.debug('Tailscale Serve configuration reset successfully');
          }
          resolve();
        });
        resetProcess.on('error', () => resolve());
        setTimeout(resolve, 2000); // Timeout after 2 seconds
      });
    } catch (_error) {
      logger.debug('Failed to reset serve config during stop');
    }

    if (!this.serveProcess) {
      logger.debug('No Tailscale Serve process to stop');
      return;
    }

    logger.info('Stopping Tailscale Serve process...');

    return new Promise<void>((resolve) => {
      if (!this.serveProcess) {
        resolve();
        return;
      }

      const cleanup = () => {
        this.cleanup();
        resolve();
      };

      // Set a timeout to force kill if graceful shutdown fails
      const forceKillTimeout = setTimeout(() => {
        if (this.serveProcess && !this.serveProcess.killed) {
          logger.warn('Force killing Tailscale Serve process');
          this.serveProcess.kill('SIGKILL');
        }
        cleanup();
      }, 5000);

      this.serveProcess.once('exit', () => {
        clearTimeout(forceKillTimeout);
        cleanup();
      });

      // Try graceful shutdown first
      this.serveProcess.kill('SIGTERM');
    });
  }

  isRunning(): boolean {
    // Check if process exists and hasn't been killed
    if (!this.serveProcess) {
      return false;
    }

    // Check if process has exited
    if (this.serveProcess.exitCode !== null || this.serveProcess.signalCode !== null) {
      // Process has exited, clean up the reference
      this.serveProcess = null;
      return false;
    }

    return !this.serveProcess.killed;
  }

  async getStatus(): Promise<TailscaleServeStatus> {
    logger.debug('[TAILSCALE STATUS] Getting status', {
      isPermanentlyDisabled: this.isPermanentlyDisabled,
      lastError: this.lastError,
      processActive: !!this.serveProcess,
      currentPort: this.currentPort,
    });

    // Debug mode: simulate errors based on environment variable
    if (process.env.VIBETUNNEL_TAILSCALE_ERROR) {
      return {
        isRunning: false,
        lastError: process.env.VIBETUNNEL_TAILSCALE_ERROR,
      };
    }

    // IMMEDIATE CHECK: Always check the actual serve status if not permanently disabled
    // The process might be running but not configured (needs admin permissions)
    if (!this.isPermanentlyDisabled) {
      logger.debug('[TAILSCALE STATUS] Checking actual Tailscale Serve configuration');

      try {
        const checkResult = await this.checkServeAvailability();
        logger.debug(`[TAILSCALE STATUS] Serve status check result: ${checkResult}`);

        if (
          checkResult.includes('Serve is not enabled') ||
          checkResult.includes('not available') ||
          checkResult.includes('requires admin') ||
          checkResult.includes('unauthorized') ||
          checkResult.includes('No serve config')
        ) {
          logger.debug(
            '[TAILSCALE STATUS] Tailscale Serve not available - marking as permanently disabled'
          );
          this.isPermanentlyDisabled = true;
          this.lastError = 'Serve is not enabled on your tailnet';

          // Return success (fallback mode)
          return {
            isRunning: false,
            port: undefined,
            lastError: undefined, // No error in fallback mode
            startTime: this.startTime,
            isPermanentlyDisabled: true,
          };
        }
      } catch (error) {
        logger.debug(`[TAILSCALE STATUS] Failed to check availability: ${error}`);
      }
    }

    // If we're permanently disabled, return that status without error
    // This is the expected fallback mode when admin permissions aren't available
    if (this.isPermanentlyDisabled) {
      logger.info('[TAILSCALE STATUS] Returning permanently disabled status (no error)');
      return {
        isRunning: false,
        port: undefined,
        // Don't report an error - fallback mode is working fine
        lastError: undefined,
        startTime: this.startTime,
        isPermanentlyDisabled: true,
      };
    }

    // Check if the serve process is running
    const processRunning = this.isRunning();
    logger.info(`[TAILSCALE STATUS] Process running: ${processRunning}`);

    // If not running and we have a permanent error, we're in fallback mode
    if (!processRunning && this.lastError?.includes('Serve is not enabled on your tailnet')) {
      logger.info('[TAILSCALE STATUS] Detected permanent failure, switching to fallback mode');
      // Mark as permanently disabled and return without error
      this.isPermanentlyDisabled = true;
      return {
        isRunning: false,
        port: undefined,
        lastError: undefined, // Don't show error in fallback mode
        startTime: this.startTime,
        isPermanentlyDisabled: true,
      };
    }

    // Always verify if Tailscale Serve is available, even if process isn't running
    // This helps detect permanent failures when the process never starts
    let actuallyRunning = processRunning;
    let verificationError: string | undefined;
    const portToCheck = this.currentPort || 4020; // Use default port if not set

    if (!processRunning && !this.isPermanentlyDisabled) {
      // Process isn't running - check if Tailscale Serve is even available
      logger.info(
        `[TAILSCALE STATUS] Process not running, checking if Tailscale Serve is available`
      );
      try {
        const isAvailable = await this.verifyServeConfiguration(portToCheck);
        logger.info(`[TAILSCALE STATUS] Tailscale Serve availability check: ${isAvailable}`);
        if (!isAvailable) {
          // Check if this is because Serve isn't enabled on the tailnet
          // Run `tailscale serve status` to get more info
          const checkResult = await this.checkServeAvailability();
          if (
            checkResult.includes('Serve is not enabled') ||
            checkResult.includes('not available') ||
            checkResult.includes('requires admin')
          ) {
            logger.info(
              '[TAILSCALE STATUS] Tailscale Serve not available on tailnet - marking as permanently disabled'
            );
            this.isPermanentlyDisabled = true;
            this.lastError = 'Serve is not enabled on your tailnet';
            // Return without error since we're in fallback mode
            return {
              isRunning: false,
              port: undefined,
              lastError: undefined,
              startTime: this.startTime,
              isPermanentlyDisabled: true,
            };
          } else {
            verificationError = 'Tailscale Serve proxy not configured for this port';
            logger.info(
              '[TAILSCALE STATUS] Tailscale Serve not configured but not a permanent failure'
            );
          }
        }
      } catch (error) {
        logger.debug(`Failed to check Tailscale Serve availability: ${error}`);
      }
    } else if (processRunning && this.currentPort) {
      logger.info(`[TAILSCALE STATUS] Verifying configuration for port ${this.currentPort}`);
      try {
        const isConfigured = await this.verifyServeConfiguration(this.currentPort);
        logger.info(`[TAILSCALE STATUS] Configuration verified: ${isConfigured}`);
        if (!isConfigured) {
          actuallyRunning = false;
          // Only show error if this isn't a permanent failure
          if (!this.lastError?.includes('Serve is not enabled on your tailnet')) {
            verificationError = 'Tailscale Serve proxy not configured for this port';
            logger.info('[TAILSCALE STATUS] Setting verification error (not permanent)');
          } else {
            // It's a permanent failure, mark it as such
            this.isPermanentlyDisabled = true;
            logger.info('[TAILSCALE STATUS] Marking as permanently disabled');
          }
        }
      } catch (error) {
        logger.debug(`Failed to verify Tailscale Serve configuration: ${error}`);
        // Don't report verification errors as user-facing errors
        actuallyRunning = false;
      }
    }

    const result = {
      isRunning: actuallyRunning,
      port: actuallyRunning ? (this.currentPort ?? undefined) : undefined,
      lastError: actuallyRunning ? undefined : verificationError || this.lastError,
      startTime: this.startTime,
      isPermanentlyDisabled: this.isPermanentlyDisabled,
    };

    logger.info('[TAILSCALE STATUS] Returning status:');
    logger.info(`  - isRunning: ${result.isRunning}`);
    logger.info(`  - lastError: ${result.lastError}`);
    logger.info(`  - isPermanentlyDisabled: ${result.isPermanentlyDisabled}`);

    return result;
  }

  /**
   * Check if Tailscale Serve is available on this tailnet
   */
  private async checkServeAvailability(): Promise<string> {
    return new Promise<string>((resolve) => {
      const statusProcess = spawn(this.tailscaleExecutable, ['serve', 'status'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      if (statusProcess.stdout) {
        statusProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });
      }

      if (statusProcess.stderr) {
        statusProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      }

      statusProcess.on('exit', (_code) => {
        // Return stderr if it contains the error message
        if (stderr) {
          resolve(stderr);
        } else {
          resolve(stdout);
        }
      });

      statusProcess.on('error', (error) => {
        resolve(error.message);
      });

      // Timeout after 3 seconds
      setTimeout(() => {
        if (!statusProcess.killed) {
          statusProcess.kill('SIGTERM');
          resolve('Timeout checking Tailscale Serve availability');
        }
      }, 3000);
    });
  }

  /**
   * Verify that Tailscale Serve is actually configured for the given port
   */
  private async verifyServeConfiguration(port: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const statusProcess = spawn(this.tailscaleExecutable, ['serve', 'status'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      if (statusProcess.stdout) {
        statusProcess.stdout.on('data', (data) => {
          stdout += data.toString();
        });
      }

      if (statusProcess.stderr) {
        statusProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      }

      statusProcess.on('exit', (code) => {
        if (code === 0) {
          // Parse the output to see if our port is configured
          const isConfigured = this.parseServeStatus(stdout, port);
          logger.debug(`Tailscale Serve status check: port ${port} configured = ${isConfigured}`);
          resolve(isConfigured);
        } else {
          logger.debug(`Tailscale serve status failed with code ${code}: ${stderr}`);
          resolve(false);
        }
      });

      statusProcess.on('error', (error) => {
        logger.debug(`Failed to run tailscale serve status: ${error.message}`);
        resolve(false);
      });

      // Timeout after 3 seconds
      setTimeout(() => {
        if (!statusProcess.killed) {
          statusProcess.kill('SIGTERM');
          resolve(false);
        }
      }, 3000);
    });
  }

  /**
   * Parse the output of 'tailscale serve status' to check if our port is configured
   */
  private parseServeStatus(output: string, port: number): boolean {
    logger.debug(`Parsing Tailscale serve status output for port ${port}:`);
    logger.debug(`Raw output: ${JSON.stringify(output)}`);

    // Look for lines containing our port number
    const lines = output.split('\n');
    logger.debug(`Split into ${lines.length} lines`);

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine) {
        logger.debug(`Checking line: "${trimmedLine}"`);
      }

      // Common patterns in Tailscale serve output:
      // "https://hostname:443 proxy http://127.0.0.1:4020"
      // "http://hostname:80 proxy http://127.0.0.1:4020"
      if (line.includes(`127.0.0.1:${port}`) || line.includes(`localhost:${port}`)) {
        logger.info(`Found proxy configuration for port ${port} in line: "${line.trim()}"`);
        return true;
      }
    }

    logger.warn(`No proxy configuration found for port ${port} in Tailscale serve status`);
    return false;
  }

  private cleanup(): void {
    // Kill the process if it's still running
    if (this.serveProcess && !this.serveProcess.killed) {
      logger.debug('Terminating orphaned Tailscale Serve process');
      try {
        this.serveProcess.kill('SIGTERM');
        // Give it a moment to terminate gracefully
        setTimeout(() => {
          if (this.serveProcess && !this.serveProcess.killed) {
            logger.warn('Force killing Tailscale Serve process');
            this.serveProcess.kill('SIGKILL');
          }
        }, 1000);
      } catch (error) {
        logger.error('Failed to kill Tailscale Serve process:', error);
      }
    }

    this.serveProcess = null;
    this.currentPort = null;
    this.isStarting = false;
    this.startTime = undefined;
    // Keep lastError for debugging
  }

  private async checkTailscaleAvailable(): Promise<void> {
    const fs = await import('fs/promises');

    // Platform-specific paths to check
    let tailscalePaths: string[] = [];

    if (process.platform === 'darwin') {
      // macOS paths
      tailscalePaths = [
        '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
        '/usr/local/bin/tailscale',
        '/opt/homebrew/bin/tailscale',
      ];
    } else if (process.platform === 'linux') {
      // Linux paths
      tailscalePaths = [
        '/usr/bin/tailscale',
        '/usr/local/bin/tailscale',
        '/opt/tailscale/bin/tailscale',
        '/snap/bin/tailscale',
      ];
    }

    // Check platform-specific paths first
    for (const path of tailscalePaths) {
      try {
        await fs.access(path, fs.constants.X_OK);
        this.tailscaleExecutable = path;
        logger.debug(`Found Tailscale at: ${path}`);
        return;
      } catch {
        // Continue checking other paths
      }
    }

    // Fallback to checking PATH
    return new Promise<void>((resolve, reject) => {
      const checkProcess = spawn('which', ['tailscale'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      checkProcess.on('exit', (code) => {
        if (code === 0) {
          // Keep default 'tailscale' which will use PATH
          resolve();
        } else {
          reject(new Error('Tailscale command not found. Please install Tailscale first.'));
        }
      });

      checkProcess.on('error', (error) => {
        reject(new Error(`Failed to check Tailscale availability: ${error.message}`));
      });
    });
  }
}

// Singleton instance
export const tailscaleServeService = new TailscaleServeServiceImpl();
