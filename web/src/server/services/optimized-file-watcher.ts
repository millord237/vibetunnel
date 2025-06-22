import * as fs from 'fs';
import * as os from 'os';
import { EventEmitter } from 'events';

interface WatchOptions {
  persistent?: boolean;
  interval?: number; // For polling fallback
}

/**
 * Optimized file watcher that uses platform-specific mechanisms for lower latency
 */
export class OptimizedFileWatcher extends EventEmitter {
  // Define event types for type safety
  on(event: 'change', listener: (stats: fs.Stats) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  emit(event: 'change', stats: fs.Stats): boolean;
  emit(event: 'error', error: Error): boolean;
  emit(event: string, ...args: any[]): boolean {
    return super.emit(event, ...args);
  }
  private watcher?: fs.FSWatcher;
  private pollInterval?: NodeJS.Timeout;
  private lastSize: number = 0;
  private lastMtime: number = 0;
  private readonly platform: string;

  constructor(
    private readonly filePath: string,
    private readonly options: WatchOptions = {}
  ) {
    super();
    this.platform = os.platform();

    // Get initial stats
    try {
      const stats = fs.statSync(filePath);
      this.lastSize = stats.size;
      this.lastMtime = stats.mtimeMs;
    } catch (_error) {
      // File might not exist yet
      this.lastSize = 0;
      this.lastMtime = 0;
    }
  }

  /**
   * Start watching the file
   */
  start(): void {
    // Use platform-specific optimizations
    switch (this.platform) {
      case 'linux':
        this.startLinuxWatch();
        break;
      case 'darwin':
        this.startMacWatch();
        break;
      case 'win32':
        this.startWindowsWatch();
        break;
      default:
        // Fallback to standard fs.watch
        this.startGenericWatch();
    }
  }

  /**
   * Linux-specific watching using inotify (through fs.watch with optimizations)
   */
  private startLinuxWatch(): void {
    // On Linux, fs.watch uses inotify which is already quite efficient
    // But we can optimize by using a more aggressive polling check
    // when we detect changes to reduce latency

    let rapidPollTimeout: NodeJS.Timeout | null = null;

    this.watcher = fs.watch(
      this.filePath,
      { persistent: this.options.persistent !== false },
      (eventType) => {
        if (eventType === 'change') {
          // Start rapid polling for 100ms to catch quick successive changes
          if (rapidPollTimeout) {
            clearTimeout(rapidPollTimeout);
          }

          // Immediate check
          this.checkFileChange();

          // Rapid poll for a short period
          let pollCount = 0;
          const rapidPoll = () => {
            this.checkFileChange();
            pollCount++;
            if (pollCount < 10) {
              // Poll 10 times over 100ms
              rapidPollTimeout = setTimeout(rapidPoll, 10);
            } else {
              rapidPollTimeout = null;
            }
          };
          rapidPollTimeout = setTimeout(rapidPoll, 10);
        }
      }
    );

    this.watcher.on('error', (error) => {
      this.emit('error', error);
      // Fallback to polling on error
      this.startPolling(50); // Fast polling as fallback
    });
  }

  /**
   * macOS-specific watching using FSEvents (through fs.watch with optimizations)
   */
  private startMacWatch(): void {
    // macOS fs.watch uses FSEvents which can have some latency
    // We'll combine it with periodic stat checks for better responsiveness

    this.watcher = fs.watch(
      this.filePath,
      { persistent: this.options.persistent !== false },
      (eventType) => {
        if (eventType === 'change') {
          this.checkFileChange();
        }
      }
    );

    this.watcher.on('error', (error) => {
      this.emit('error', error);
      this.startPolling(50);
    });

    // Also add a periodic check every 50ms for better latency on macOS
    // FSEvents can sometimes batch changes causing delays
    this.startPolling(50);
  }

  /**
   * Windows-specific watching with optimizations
   */
  private startWindowsWatch(): void {
    // Windows fs.watch uses ReadDirectoryChangesW which is quite responsive
    // But we'll add some optimizations for better performance

    this.watcher = fs.watch(
      this.filePath,
      { persistent: this.options.persistent !== false },
      (eventType) => {
        if (eventType === 'change') {
          // On Windows, we might get multiple events for a single change
          // Debounce by checking actual file stats
          this.checkFileChange();
        }
      }
    );

    this.watcher.on('error', (error) => {
      this.emit('error', error);
      this.startPolling(50);
    });
  }

  /**
   * Generic watching fallback
   */
  private startGenericWatch(): void {
    this.watcher = fs.watch(
      this.filePath,
      { persistent: this.options.persistent !== false },
      (eventType) => {
        if (eventType === 'change') {
          this.checkFileChange();
        }
      }
    );

    this.watcher.on('error', (error) => {
      this.emit('error', error);
      this.startPolling(100);
    });
  }

  /**
   * Start polling as a fallback mechanism
   */
  private startPolling(interval: number): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    this.pollInterval = setInterval(() => {
      this.checkFileChange();
    }, interval);
  }

  /**
   * Check if file has actually changed by comparing stats
   */
  private checkFileChange(): void {
    try {
      const stats = fs.statSync(this.filePath);

      // Check if size or modification time changed
      if (stats.size !== this.lastSize || stats.mtimeMs !== this.lastMtime) {
        // Only emit if size increased (for append-only files like asciinema)
        if (stats.size > this.lastSize) {
          this.lastSize = stats.size;
          this.lastMtime = stats.mtimeMs;
          this.emit('change', stats);
        } else if (stats.size !== this.lastSize) {
          // File was truncated or replaced
          this.lastSize = stats.size;
          this.lastMtime = stats.mtimeMs;
          this.emit('change', stats);
        }
      }
    } catch (error) {
      // File might have been deleted
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.emit('error', error as Error);
      }
    }
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = undefined;
    }
  }

  /**
   * Check if watcher is active
   */
  isWatching(): boolean {
    return !!this.watcher || !!this.pollInterval;
  }
}

/**
 * Factory function to create an optimized file watcher
 */
export function createOptimizedFileWatcher(
  filePath: string,
  options?: WatchOptions
): OptimizedFileWatcher {
  return new OptimizedFileWatcher(filePath, options);
}
